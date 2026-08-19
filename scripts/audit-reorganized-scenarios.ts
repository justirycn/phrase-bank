import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { SystemContentPhrase } from "../app/domain/types";
import { loadLocalQwenEnv } from "./content-agent/localQwenEnv";
import { createQwenClient, type QwenClient, type QwenMessage } from "./content-agent/qwenClient";
import { generateReorganizedContentSource } from "./content-agent/reorganizedGenerator";
import { scenarioGoals } from "./content-agent/reorganizedScenarioGoals";
import { sourceSha256 } from "./content-agent/qwenCheckpoint";

type Checkpoint = { version: string; sourceSha256: string; generatedAt: string; phrases: SystemContentPhrase[] };
type AuditState = { version: string; completed: string[] };
type Correction = { id: string; english: string; chinese: string };
type AuditResponse = { status: "pass" | "fail"; issues: string[]; corrections: Correction[] };

function parseAudit(raw: string, allowedIds: Set<string>): AuditResponse {
  const fenced = raw.trim().match(/^```json\s*([\s\S]*?)\s*```$/i);
  const value = JSON.parse(fenced ? fenced[1] : raw) as AuditResponse;
  if (!value || !Array.isArray(value.issues) || !Array.isArray(value.corrections)) {
    throw new Error("场景审计未通过或响应格式无效");
  }
  if (value.status !== "pass") throw new Error(`场景审计要求重试：${value.issues.join("；") || "未提供原因"}`);
  const seen = new Set<string>();
  for (const correction of value.corrections) {
    if (!correction || typeof correction.id !== "string" || !allowedIds.has(correction.id) || seen.has(correction.id)
      || typeof correction.english !== "string" || !correction.english.trim()
      || typeof correction.chinese !== "string" || !correction.chinese.trim()
      || Object.keys(correction).some((key) => !["id", "english", "chinese"].includes(key))) {
      throw new Error("场景审计修正项无效");
    }
    seen.add(correction.id);
  }
  if (seen.size !== allowedIds.size || [...allowedIds].some((id) => !seen.has(id))) {
    throw new Error("场景审计必须返回该场景的全部条目");
  }
  return value;
}

function messages(key: string, phrases: SystemContentPhrase[], all: SystemContentPhrase[], feedback?: string): QwenMessage[] {
  const byId = new Map(all.map((phrase) => [phrase.id, phrase]));
  const [categoryId, subcategory] = key.split(":");
  const goals = scenarioGoals(categoryId, subcategory);
  const familyCores = phrases.filter(({ kind }) => kind === "core");
  const goalByCoreId = new Map(familyCores.map((phrase, index) => [phrase.id, goals[index]]));
  const input = phrases.map((phrase) => ({
    id: phrase.id, kind: phrase.kind, intent: phrase.intent, unlockOrder: phrase.unlockOrder,
    assignedGoal: goalByCoreId.get(phrase.kind === "core" ? phrase.id : phrase.parentPhraseId ?? ""),
    english: phrase.english, chinese: phrase.chinese,
    parentEnglish: phrase.parentPhraseId ? byId.get(phrase.parentPhraseId)?.english : undefined,
  }));
  return [
    { role: "system", content: "你是资深英语口语课程主编，负责整组场景验收，不继承之前的生成或审校上下文。只返回 JSON。" },
    { role: "user", content: `从头重建场景 ${key} 的 10 个核心句及全部案例，不要默认保留输入原句。subcategory 与 assignedGoal 是强制语义约束：每个核心句必须直接完成自己的 assignedGoal，不能用无关的通用担忧、请求或回应代替；每个 example 必须迁移其父句的同一 assignedGoal 到不同人物或真实情境，不能复述父句。风格必须像普通英语使用者每天会说的朴素短句，优先最常用、最容易脱口而出的表达；严禁文学化比喻、俏皮创作、段子、戏剧化细节、企业宣传腔和不必要的故事。核心句通常控制在 4–18 个英文单词。逐条强制保证：1）仅看句子本身就明显属于对应场景和 assignedGoal；2）开箱即用且语境清楚；3）禁止 [Name]、[task]、X 等占位符，禁止虚构人名、街道、机构、订单号、运单号、金额、精确日期时间和品牌；不得使用星号等 Markdown；4）需要自我介绍时可以说 “I don't think we've met” 等无姓名表达，不得编造 Sam、Jamie 之类名字；5）英文自然简洁，中文完整自然且不得夹杂未翻译英文；6）整组不得近义重复。不要改 ID 或元数据。必须返回场景内每一个输入 ID，不能省略任何条目。返回 {"status":"pass","issues":["重建摘要"],"corrections":[{"id":"每个输入ID","english":"最终英文","chinese":"最终中文"}]}，不得有额外字段；无法形成可发布内容才返回 fail。${feedback ? `上一轮响应未被接受：${feedback}。请据此修正响应并完成本组。` : ""}输入：${JSON.stringify(input)}` },
  ];
}

async function auditFamily(client: QwenClient, key: string, family: SystemContentPhrase[], all: SystemContentPhrase[], allowedIds: Set<string>) {
  let feedback: string | undefined;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try { return parseAudit(await client.complete(messages(key, family, all, feedback)), allowedIds); }
    catch (error) { feedback = error instanceof Error ? error.message : String(error); }
  }
  throw new Error(`${key} 连续三次未能完成场景审计：${feedback}`);
}

async function atomicJson(path: string, value: unknown) {
  const pending = `${path}.pending.${process.pid}.${randomUUID()}`;
  await writeFile(pending, `${JSON.stringify(value)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(pending, path);
}

export async function auditReorganizedScenarios(options: { version: string; client: QwenClient; checkpointPath?: string; statePath?: string; onlyKeys?: Set<string>; writeOutput?: (value: string) => void }) {
  const checkpointPath = options.checkpointPath ?? resolve(`.content-agent/checkpoint-${options.version}.json`);
  const statePath = options.statePath ?? resolve(`.content-agent/semantic-rebuild-v4-${options.version}.json`);
  const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8")) as Checkpoint;
  if (checkpoint.version !== options.version || checkpoint.phrases.length !== 2000) throw new Error("完整内容断点无效");
  const source = generateReorganizedContentSource();
  const sourceById = new Map(source.phrases.map((phrase) => [phrase.id, phrase]));
  checkpoint.phrases = checkpoint.phrases.map((phrase) => {
    const sourcePhrase = sourceById.get(phrase.id);
    if (!sourcePhrase) throw new Error(`内容断点包含未知 ID: ${phrase.id}`);
    return { ...phrase, intent: sourcePhrase.intent };
  });
  checkpoint.sourceSha256 = sourceSha256(source);
  await atomicJson(checkpointPath, checkpoint);
  let state: AuditState = { version: options.version, completed: [] };
  try { state = JSON.parse(await readFile(statePath, "utf8")) as AuditState; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (state.version !== options.version || !Array.isArray(state.completed)) throw new Error("场景审计断点无效");
  const completed = new Set(state.completed);
  const cores = checkpoint.phrases.filter(({ kind }) => kind === "core");
  const keys = [...new Set(cores.map(({ categoryId, subcategory }) => `${categoryId}:${subcategory}`))];
  const output = options.writeOutput ?? ((value: string) => process.stdout.write(value));
  const pending = keys.map((key, index) => ({ key, index })).filter(({ key }) => !completed.has(key) && (!options.onlyKeys || options.onlyKeys.has(key)));
  for (let offset = 0; offset < pending.length; offset += 4) {
    const batch = pending.slice(offset, offset + 4);
    const snapshot = checkpoint.phrases;
    const rebuilt = await Promise.all(batch.map(async ({ key, index }) => {
      const [categoryId, subcategory] = key.split(":");
      const familyCores = cores.filter((phrase) => phrase.categoryId === categoryId && phrase.subcategory === subcategory);
      const coreIds = new Set(familyCores.map(({ id }) => id));
      const family = snapshot.filter((phrase) => coreIds.has(phrase.id) || coreIds.has(phrase.parentPhraseId ?? ""));
      const allowedIds = new Set(family.map(({ id }) => id));
      const draft = await auditFamily(options.client, key, family, snapshot, allowedIds);
      const draftCorrections = new Map(draft.corrections.map((correction) => [correction.id, correction]));
      const draftedPhrases = snapshot.map((phrase) => {
        const correction = draftCorrections.get(phrase.id);
        return correction ? { ...phrase, english: correction.english.trim(), chinese: correction.chinese.trim() } : phrase;
      });
      const draftedFamily = draftedPhrases.filter((phrase) => allowedIds.has(phrase.id));
      const audit = await auditFamily(options.client, key, draftedFamily, draftedPhrases, allowedIds);
      return { key, index, corrections: audit.corrections };
    }));
    const corrections = new Map(rebuilt.flatMap((result) => result.corrections.map((correction) => [correction.id, correction] as const)));
    checkpoint.phrases = checkpoint.phrases.map((phrase) => {
      const correction = corrections.get(phrase.id);
      return correction ? { ...phrase, english: correction.english.trim(), chinese: correction.chinese.trim() } : phrase;
    });
    for (const result of rebuilt) completed.add(result.key);
    state = { version: options.version, completed: [...completed] };
    await atomicJson(checkpointPath, checkpoint);
    await atomicJson(statePath, state);
    for (const result of rebuilt) output(`场景审计 ${result.index + 1}/${keys.length} · ${result.key} · 修正 ${result.corrections.length} 条\n`);
  }
}

async function main() {
  const versionIndex = process.argv.indexOf("--version");
  const version = versionIndex >= 0 ? process.argv[versionIndex + 1] : undefined;
  if (!version) throw new Error("请通过 --version 指定内容版本");
  const onlyKeys = new Set(process.argv.flatMap((value, index) => value === "--scenario" && process.argv[index + 1] ? [process.argv[index + 1]] : []));
  const config = await loadLocalQwenEnv({ repositoryRoot: process.cwd() });
  await auditReorganizedScenarios({ version, client: createQwenClient({ ...config, timeoutMs: 120_000, temperature: 0.2 }), onlyKeys: onlyKeys.size ? onlyKeys : undefined });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
