import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SystemContentPackage, SystemContentPhrase } from "../../app/domain/types";
import { inspectSystemContent } from "./qualityGate";
import type { QwenClient, QwenMessage } from "./qwenClient";

const CATEGORY_QUOTAS = [
  ["daily", 180], ["travel", 100], ["work", 120], ["business", 100], ["supply-chain", 70], ["social", 30],
] as const;

interface PipelineOptions { client: QwenClient; version: string; generatedAt: string; qualityVersion: string; }
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

function generationMessages(category: string, coreCount: number, chunkIndex: number, chunkCount: number, options: PipelineOptions): QwenMessage[] {
  return [
    { role: "system", content: "你是英语口语课程内容设计师。只返回 JSON，不要 Markdown。内容必须自然、实用、准确，适合中国成年学习者。" },
    { role: "user", content: `为 ${category} 类别生成第 ${chunkIndex + 1}/${chunkCount} 批：精确 ${coreCount} 个核心语言块，每个核心 2–3 个相关发散案例。ID 使用该类别的稳定槽位，批次之间不得重复。总包最终必须为 600 核心、2000 条。CEFR 仅 A2/B1/B2。使用版本 ${options.version} 和质检版本 ${options.qualityVersion}。返回 '{"phrases":[...]}'。` },
  ];
}

function reviewMessages(category: string, coreCount: number, batch: BatchResponse): QwenMessage[] {
  return [
    { role: "system", content: "你是独立审校员，不继承生成上下文。检查口语自然度、中英文一致性、实用性、重复、冒犯或危险内容。只返回 JSON。" },
    { role: "user", content: `独立审校 ${category} 批次，必须包含 ${coreCount} 个核心。修正后返回 '{"status":"pass|fail","issues":[],"phrases":[...]}'。输入：${JSON.stringify(batch)}` },
  ];
}

function assertBatch(category: string, coreCount: number, batch: BatchResponse) {
  if (!batch || !Array.isArray(batch.phrases)) throw new Error(`${category} 批次格式无效`);
  if (batch.phrases.some((phrase) => phrase.categoryId !== category)) throw new Error(`${category} 批次包含错误类别`);
  const cores = batch.phrases.filter(({ kind }) => kind === "core").length;
  if (cores !== coreCount) throw new Error(`${category} 核心数量错误：${cores}`);
}

export async function buildQwenCandidate(options: PipelineOptions): Promise<SystemContentPackage> {
  const phrases: SystemContentPhrase[] = [];
  for (const [category, coreQuota] of CATEGORY_QUOTAS) {
    const chunkCount = Math.ceil(coreQuota / MAX_CORES_PER_REQUEST);
    const categoryPhrases: SystemContentPhrase[] = [];
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      const coreCount = Math.min(MAX_CORES_PER_REQUEST, coreQuota - chunkIndex * MAX_CORES_PER_REQUEST);
      const generated = parseJson<BatchResponse>(await options.client.complete(generationMessages(category, coreCount, chunkIndex, chunkCount, options)));
      assertBatch(category, coreCount, generated);
      const reviewed = parseJson<ReviewResponse>(await options.client.complete(reviewMessages(category, coreCount, generated)));
      if (reviewed.status !== "pass") throw new Error(`${category} 审校未通过`);
      assertBatch(category, coreCount, reviewed);
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
