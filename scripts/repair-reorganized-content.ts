import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { SystemContentPackage, SystemContentPhrase } from "../app/domain/types";
import { inspectSystemContent } from "./content-agent/qualityGate";
import { loadLocalQwenEnv } from "./content-agent/localQwenEnv";
import { createQwenClient, type QwenClient, type QwenMessage } from "./content-agent/qwenClient";

type Checkpoint = { version: string; sourceSha256: string; generatedAt: string; phrases: SystemContentPhrase[] };
type Patch = { id: string; english: string; chinese: string };
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function conflictingPhraseIds(content: SystemContentPackage): string[] {
  const ids = new Set<string>();
  const groups = Object.values(Object.groupBy(content.phrases, ({ english }) => normalize(english)));
  for (const group of groups) {
    if (group.length < 2) continue;
    const preferred = [...group].sort((left, right) => Number(left.kind === "example") - Number(right.kind === "example"))[0];
    for (const phrase of group) if (phrase.id !== preferred.id) ids.add(phrase.id);
  }
  for (const error of inspectSystemContent(content).errors) {
    const match = error.match(/^example is only a lexical paraphrase: (.+)$/);
    if (match) ids.add(match[1]);
    const placeholder = error.match(/^content contains a placeholder or brand-dependent identifier: (.+)$/);
    if (placeholder) ids.add(placeholder[1]);
  }
  return [...ids];
}

function parsePatches(raw: string, expectedIds: string[]): Patch[] {
  const fenced = raw.trim().match(/^```json\s*([\s\S]*?)\s*```$/i);
  const value = JSON.parse(fenced ? fenced[1] : raw) as { phrases?: unknown[] };
  if (!Array.isArray(value.phrases)) throw new Error("修复响应缺少 phrases 数组");
  const patches = value.phrases as Array<Record<string, unknown>>;
  const actualIds = patches.map(({ id }) => id);
  if (patches.length !== expectedIds.length || new Set(actualIds).size !== expectedIds.length
    || expectedIds.some((id) => !actualIds.includes(id))) throw new Error("修复响应 ID 集不完整");
  for (const patch of patches) {
    if (Object.keys(patch).some((key) => !["id", "english", "chinese"].includes(key))
      || typeof patch.id !== "string" || typeof patch.english !== "string" || !patch.english.trim()
      || typeof patch.chinese !== "string" || !patch.chinese.trim()) throw new Error("修复响应字段无效");
  }
  return patches.map(({ id, english, chinese }) => ({ id: String(id), english: String(english).trim(), chinese: String(chinese).trim() }));
}

function promptRecords(targets: SystemContentPhrase[], all: SystemContentPhrase[]) {
  const byId = new Map(all.map((phrase) => [phrase.id, phrase]));
  return targets.map((phrase) => ({
    id: phrase.id, categoryId: phrase.categoryId, subcategory: phrase.subcategory, intent: phrase.intent,
    kind: phrase.kind, unlockOrder: phrase.unlockOrder, english: phrase.english, chinese: phrase.chinese,
    parentEnglish: phrase.parentPhraseId ? byId.get(phrase.parentPhraseId)?.english : undefined,
  }));
}

function repairMessages(records: ReturnType<typeof promptRecords>): QwenMessage[] {
  return [
    { role: "system", content: "你是英语口语课程内容修订师。只返回 JSON。" },
    { role: "user", content: `以下条目与全库其他内容完全重复、案例只是父句的词汇改写，或含有不可发布的占位信息。逐条重写英文和中文，同时保留各自 categoryId、subcategory、intent 和 kind 所表达的沟通功能。英文必须是当代真实对话中的高频自然短句；案例必须迁移到与 parentEnglish 不同的具体人物或情境，不能只换句首、语气或一个名词。各条新英文彼此不得相同，也不得继续使用原英文。严禁方括号变量、独立 X、PO/SKU/运单等虚构编号，以及 FedEx、UPS、DHL 等品牌名；需要提到订单或包裹时用自然的无编号说法。中文自然准确。只返回 {"phrases":[{"id":"原ID","english":"新英文","chinese":"新中文"}]}，每个 ID 恰好一次且不得有额外字段。输入：${JSON.stringify(records)}` },
  ];
}

function reviewMessages(records: ReturnType<typeof promptRecords>): QwenMessage[] {
  return [
    { role: "system", content: "你是独立英语口语审校员，不继承修订上下文。只返回 JSON。" },
    { role: "user", content: `独立检查以下修订：是否为真实高频口语、含义清楚、中文准确、互不重复；example 是否真正迁移了 parentEnglish 的沟通功能，而非表面改写。不得包含方括号变量、独立 X、PO/SKU/运单等虚构编号，或 FedEx、UPS、DHL 等品牌名。发现问题时直接修正。只返回 {"phrases":[{"id":"原ID","english":"最终英文","chinese":"最终中文"}]}，所有 ID 恰好一次且不得有额外字段。输入：${JSON.stringify(records)}` },
  ];
}

function applyPatches(phrases: SystemContentPhrase[], patches: Patch[]) {
  const byId = new Map(patches.map((patch) => [patch.id, patch]));
  return phrases.map((phrase) => {
    const patch = byId.get(phrase.id);
    return patch ? { ...phrase, english: patch.english, chinese: patch.chinese } : phrase;
  });
}

async function writeCheckpoint(path: string, checkpoint: Checkpoint) {
  const pending = `${path}.repair.${process.pid}.${randomUUID()}`;
  await writeFile(pending, `${JSON.stringify(checkpoint)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(pending, path);
}

export async function repairReorganizedContent(options: { version: string; client: QwenClient; checkpointPath?: string; writeOutput?: (value: string) => void }) {
  const checkpointPath = options.checkpointPath ?? resolve(`.content-agent/checkpoint-${options.version}.json`);
  const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8")) as Checkpoint;
  if (checkpoint.version !== options.version || checkpoint.phrases.length !== 2000) throw new Error("完整内容断点无效");
  const output = options.writeOutput ?? ((value: string) => process.stdout.write(value));
  for (let round = 1; round <= 3; round += 1) {
    const content: SystemContentPackage = { format: "phrase-bank-system-content", version: options.version, generatedAt: checkpoint.generatedAt, qualityVersion: "qwen-plus-review-v3", phrases: checkpoint.phrases };
    const ids = conflictingPhraseIds(content);
    if (!ids.length) {
      const report = inspectSystemContent(content);
      if (report.errors.length) throw new Error(`修复后仍未通过质量门：${report.errors[0]}`);
      output("全库重复与案例迁移门禁已通过。\n");
      return;
    }
    output(`修复轮次 ${round}：${ids.length} 条冲突记录。\n`);
    for (let index = 0; index < ids.length; index += 10) {
      const sliceIds = ids.slice(index, index + 10);
      const targets = sliceIds.map((id) => checkpoint.phrases.find((phrase) => phrase.id === id)!);
      const drafted = parsePatches(await options.client.complete(repairMessages(promptRecords(targets, checkpoint.phrases))), sliceIds);
      const draftedPhrases = applyPatches(checkpoint.phrases, drafted);
      const draftedTargets = sliceIds.map((id) => draftedPhrases.find((phrase) => phrase.id === id)!);
      const reviewed = parsePatches(await options.client.complete(reviewMessages(promptRecords(draftedTargets, draftedPhrases))), sliceIds);
      checkpoint.phrases = applyPatches(checkpoint.phrases, reviewed);
      await writeCheckpoint(checkpointPath, checkpoint);
      output(`已修复并复审 ${Math.min(index + 10, ids.length)}/${ids.length}。\n`);
    }
  }
  throw new Error("三轮修复后仍存在跨批冲突");
}

async function main() {
  const versionIndex = process.argv.indexOf("--version");
  const version = versionIndex >= 0 ? process.argv[versionIndex + 1] : undefined;
  if (!version) throw new Error("请通过 --version 指定内容版本");
  const config = await loadLocalQwenEnv({ repositoryRoot: process.cwd() });
  await repairReorganizedContent({ version, client: createQwenClient({ ...config, timeoutMs: 120_000 }) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
