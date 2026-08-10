import type { PhraseKind, PhraseOrigin, SystemContentPackage } from "./types";

export function personalPhraseDefaults(): { origin: PhraseOrigin; kind: PhraseKind } {
  return { origin: "personal", kind: "standalone" };
}

function invalid(reason: string): never {
  throw new Error(`系统内容包无效：${reason}`);
}

export function validateSystemContentPackage(value: SystemContentPackage): SystemContentPackage {
  if (value.format !== "phrase-bank-system-content" || !value.version.trim()) invalid("版本信息缺失");
  if (!Number.isFinite(Date.parse(value.generatedAt)) || !value.qualityVersion.trim()) invalid("生成信息缺失");

  const ids = new Set<string>();
  for (const phrase of value.phrases) {
    if (!phrase.id.trim() || ids.has(phrase.id)) invalid("内容 ID 重复或为空");
    ids.add(phrase.id);
    if (phrase.origin !== "system" || !["core", "example"].includes(phrase.kind)) invalid("内容来源或类型错误");
    if (!["A2", "B1", "B2"].includes(phrase.cefrLevel)) invalid("CEFR 难度错误");
    if (!phrase.english.trim() || !phrase.chinese.trim() || !phrase.categoryId.trim() || !phrase.subcategory.trim() || !phrase.intent.trim()) invalid("必填内容缺失");
    if (phrase.contentVersion !== value.version || phrase.qualityVersion !== value.qualityVersion) invalid("内容版本不一致");
    if (phrase.kind === "core" && (phrase.parentPhraseId !== undefined || phrase.unlockOrder !== undefined)) invalid("核心句层级错误");
    if (phrase.kind === "example" && (!phrase.parentPhraseId || !Number.isInteger(phrase.unlockOrder) || (phrase.unlockOrder ?? 0) < 1)) invalid("案例层级错误");
  }

  const cores = new Set(value.phrases.filter(({ kind }) => kind === "core").map(({ id }) => id));
  const orders = new Map<string, number[]>();
  for (const phrase of value.phrases.filter(({ kind }) => kind === "example")) {
    if (!cores.has(phrase.parentPhraseId!)) invalid("案例父级不存在");
    const current = orders.get(phrase.parentPhraseId!) ?? [];
    current.push(phrase.unlockOrder!);
    orders.set(phrase.parentPhraseId!, current);
  }
  for (const values of orders.values()) {
    values.sort((a, b) => a - b);
    if (values.some((order, index) => order !== index + 1)) invalid("案例解锁顺序不连续");
  }
  return structuredClone(value);
}
