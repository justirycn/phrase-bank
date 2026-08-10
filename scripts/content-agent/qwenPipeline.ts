import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SystemContentPackage, SystemContentPhrase } from "../../app/domain/types";
import { inspectSystemContent } from "./qualityGate";
import type { QwenClient, QwenMessage } from "./qwenClient";
import { generateSystemContent } from "./generator";

const CATEGORY_QUOTAS = [
  ["daily", 180], ["travel", 100], ["work", 120], ["business", 100], ["supply-chain", 70], ["social", 30],
] as const;

interface PipelineOptions { client: QwenClient; version: string; generatedAt: string; qualityVersion: string; sourceContent?: SystemContentPackage; }
interface AgentOptions extends PipelineOptions { outputDir: string; }
interface BatchResponse { phrases: SystemContentPhrase[]; }
interface ReviewResponse extends BatchResponse { status: "pass" | "fail"; issues: string[]; }

function parseJson<T>(value: string): T {
  const trimmed = value.trim();
  const match = trimmed.match(/^```json\s*([\s\S]*?)\s*```$/i);
  const json = match ? match[1] : trimmed;
  if (!match && (json.startsWith("```") || !json.startsWith("{"))) throw new Error("Qwen 返回的内容不是纯 JSON");
  try { return JSON.parse(json) as T; }
  catch { throw new Error("Qwen 返回的 JSON 无法解析"); }
}

const MAX_CORES_PER_REQUEST = 20;

function generationMessages(category: string, coreCount: number, exampleCount: number, chunkIndex: number, chunkCount: number, source: BatchResponse, options: PipelineOptions): QwenMessage[] {
  return [
    { role: "system", content: "你是英语口语课程内容设计师。只返回 JSON，不要 Markdown。内容必须自然、实用、准确，适合中国成年学习者。" },
    { role: "user", content: `优化 ${category} 类别第 ${chunkIndex + 1}/${chunkCount} 批：精确 ${coreCount} 个核心语言块，每个核心恰好 ${exampleCount} 个案例。只改写英文和中文以提升自然度与准确性；必须逐条保留输入中的 id、父子关系、顺序、类别、意图和 CEFR，批次之间不得重复。使用版本 ${options.version} 和质检版本 ${options.qualityVersion}。返回 '{"phrases":[...]}'。输入模板：${JSON.stringify(source)}` },
  ];
}

function reviewMessages(category: string, coreCount: number, batch: BatchResponse): QwenMessage[] {
  return [
    { role: "system", content: "你是独立审校员，不继承生成上下文。检查口语自然度、中英文一致性、实用性、重复、冒犯或危险内容。只返回 JSON。" },
    { role: "user", content: `独立审校 ${category} 批次，必须包含 ${coreCount} 个核心。修正后返回 '{"status":"pass|fail","issues":[],"phrases":[...]}'。输入：${JSON.stringify(batch)}` },
  ];
}

function assertBatch(category: string, coreCount: number, batch: BatchResponse, source?: BatchResponse) {
  if (!batch || !Array.isArray(batch.phrases)) throw new Error(`${category} 批次格式无效`);
  if (batch.phrases.some((phrase) => phrase.categoryId !== category)) throw new Error(`${category} 批次包含错误类别`);
  const cores = batch.phrases.filter(({ kind }) => kind === "core").length;
  if (cores !== coreCount) throw new Error(`${category} 核心数量错误：${cores}`);
  if (source) {
    const expectedIds = source.phrases.map(({ id }) => id).sort();
    const actualIds = batch.phrases.map(({ id }) => id).sort();
    if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) throw new Error(`${category} 批次 ID 与输入模板不一致`);
  }
}

export async function buildQwenCandidate(options: PipelineOptions): Promise<SystemContentPackage> {
  const phrases: SystemContentPhrase[] = [];
  const sourceContent = options.sourceContent ?? generateSystemContent();
  for (const [category, coreQuota] of CATEGORY_QUOTAS) {
    const sourcePhrases = sourceContent.phrases.filter((phrase) => phrase.categoryId === category);
    const sourceCores = sourcePhrases.filter(({ kind }) => kind === "core");
    if (sourceCores.length !== coreQuota) throw new Error(`${category} 输入模板配额错误`);
    const chunkCount = Math.ceil(sourceCores.length / MAX_CORES_PER_REQUEST);
    const categoryPhrases: SystemContentPhrase[] = [];
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      const coreCount = Math.min(MAX_CORES_PER_REQUEST, coreQuota - chunkIndex * MAX_CORES_PER_REQUEST);
      const chunkCores = sourceCores.slice(chunkIndex * MAX_CORES_PER_REQUEST, chunkIndex * MAX_CORES_PER_REQUEST + coreCount);
      const coreIds = new Set(chunkCores.map(({ id }) => id));
      const source: BatchResponse = { phrases: sourcePhrases.filter((phrase) => phrase.kind === "core" ? coreIds.has(phrase.id) : coreIds.has(phrase.parentPhraseId ?? "")) };
      const exampleCount = source.phrases.filter(({ kind }) => kind === "example").length / coreCount;
      if (!Number.isInteger(exampleCount)) throw new Error(`${category} 输入模板案例数量不一致`);
      const generated = parseJson<BatchResponse>(await options.client.complete(generationMessages(category, coreCount, exampleCount, chunkIndex, chunkCount, source, options)));
      assertBatch(category, coreCount, generated, source);
      const reviewed = parseJson<ReviewResponse>(await options.client.complete(reviewMessages(category, coreCount, generated)));
      if (reviewed.status !== "pass") throw new Error(`${category} 审校未通过`);
      assertBatch(category, coreCount, reviewed, source);
      categoryPhrases.push(...reviewed.phrases);
    }
    if (categoryPhrases.filter(({ kind }) => kind === "core").length !== coreQuota) throw new Error(`${category} 总配额不完整`);
    phrases.push(...categoryPhrases);
  }
  const content: SystemContentPackage = { format: "phrase-bank-system-content", version: options.version, generatedAt: options.generatedAt, qualityVersion: options.qualityVersion, phrases };
  const report = inspectSystemContent(content);
  if (report.errors.length) throw new Error(`候选内容未通过质量门：${report.errors[0]}`);
  return content;
}

export async function runQwenAgent(options: AgentOptions) {
  const content = await buildQwenCandidate(options);
  const report = inspectSystemContent(content);
  await mkdir(options.outputDir, { recursive: true });
  const candidatePath = join(options.outputDir, `candidate-${options.version}.json`);
  const reportPath = join(options.outputDir, `report-${options.version}.json`);
  await writeFile(candidatePath, `${JSON.stringify(content, null, 2)}\n`, "utf8");
  await writeFile(reportPath, `${JSON.stringify({ status: "pass", version: options.version, ...report }, null, 2)}\n`, "utf8");
  return { candidatePath, reportPath };
}
