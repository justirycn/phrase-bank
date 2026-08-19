import { validateSystemContentPackage } from "../../app/domain/systemContent";
import type { SystemContentPackage } from "../../app/domain/types";
import { BLUEPRINTS } from "./catalog";
import { REORGANIZED_CORE_QUOTAS, REORGANIZED_SUBCATEGORIES } from "./reorganizedCatalog";

const spokenStopWords = new Set("a an the i me my we our you your it this that to for of in on at as and or but if is are am be been being do does did have has had can could would should will just really some any with from about into up out please need planning plan like want trying during before after when while help helping".split(" "));
const words = (value: string) => value.toLowerCase().replace(/[^a-z0-9']+/g, " ").trim().split(/\s+/).filter(Boolean);
const contentWords = (value: string) => new Set(words(value).filter((word) => !spokenStopWords.has(word)));
const similarity = (left: Set<string>, right: Set<string>) => {
  const union = new Set([...left, ...right]);
  return union.size ? [...left].filter((word) => right.has(word)).length / union.size : 0;
};

export function inspectSystemContent(content: SystemContentPackage) {
  const errors: string[] = [];
  try { validateSystemContentPackage(content); } catch (error) { errors.push(error instanceof Error ? error.message : "invalid package"); }
  const cores = content.phrases.filter(({ kind }) => kind === "core");
  const coreByCategory = Object.fromEntries(["daily", "travel", "work", "business", "supply-chain", "social"].map((category) => [category, cores.filter(({ categoryId }) => categoryId === category).length]));
  const normalized = new Set<string>();
  for (const phrase of content.phrases) {
    const key = phrase.english.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (normalized.has(key)) errors.push(`duplicate English: ${phrase.english}`);
    normalized.add(key);
    if (/\bi\b/.test(phrase.english)) errors.push(`lowercase I: ${phrase.english}`);
  }
  const translatedSubcategories = new Map(BLUEPRINTS.flatMap(({ id, families }) => families
    .filter(({ subcategoryZh }) => Boolean(subcategoryZh))
    .map(({ subcategory, subcategoryZh }) => [`${id}:${subcategory}`, subcategoryZh!] as const)));
  const coresBySubcategory = new Map<string, typeof cores>();
  for (const core of cores) {
    const key = `${core.categoryId}:${core.subcategory}`;
    coresBySubcategory.set(key, [...(coresBySubcategory.get(key) ?? []), core]);
  }
  for (const [key, familyCores] of coresBySubcategory) {
    if (familyCores.every(({ id }) => id.startsWith("sys-v4-"))) continue;
    const subcategory = familyCores[0].subcategory;
    const repeatedLead = familyCores.filter(({ english }) => [
      `For ${subcategory},`,
      `Regarding ${subcategory},`,
      `When it comes to ${subcategory},`,
    ].some((lead) => english.startsWith(lead))).length;
    if (repeatedLead > Math.ceil(familyCores.length / 2)) errors.push(`repeated family opening: ${subcategory}`);
    const translated = translatedSubcategories.get(key);
    if (translated && familyCores.some(({ chinese }) => !chinese.includes(translated))) {
      errors.push(`missing translated context: ${subcategory}`);
    }
  }
  if (cores.length !== 600) errors.push(`expected 600 cores, got ${cores.length}`);
  if (content.phrases.length !== 2000) errors.push(`expected 2000 phrases, got ${content.phrases.length}`);
  if (content.qualityVersion === "qwen-plus-review-v3") {
    for (const [category, quota] of Object.entries(REORGANIZED_CORE_QUOTAS)) {
      if (coreByCategory[category] !== quota) errors.push(`expected ${quota} ${category} cores, got ${coreByCategory[category]}`);
    }
    const actualSubcategories = new Set(cores.map(({ categoryId, subcategory }) => `${categoryId}:${subcategory}`));
    for (const expected of REORGANIZED_SUBCATEGORIES) {
      if (!actualSubcategories.has(expected)) errors.push(`missing required spoken scenario: ${expected}`);
    }
    if (content.phrases.some(({ english, chinese }) => /^Write one common|^Transfer "/i.test(english) || /创作一句|沟通功能迁移/.test(chinese))) {
      errors.push("content still contains generation briefs");
    }
    const openings = new Map<string, number>();
    for (const phrase of content.phrases) {
      const opening = words(phrase.english).slice(0, 4).join(" ");
      openings.set(opening, (openings.get(opening) ?? 0) + 1);
    }
    const concentrated = [...openings].find(([, count]) => count > 60);
    if (concentrated) errors.push(`overused spoken opening: ${concentrated[0]} (${concentrated[1]})`);
    const byId = new Map(content.phrases.map((phrase) => [phrase.id, phrase]));
    for (const example of content.phrases.filter(({ kind }) => kind === "example")) {
      const core = byId.get(example.parentPhraseId ?? "");
      if (!core) continue;
      const left = contentWords(core.english);
      const right = contentWords(example.english);
      if (left.size >= 2 && right.size >= 2 && similarity(left, right) >= 0.8) {
        errors.push(`example is only a lexical paraphrase: ${example.id}`);
      }
    }
  }
  return { coreCount: cores.length, totalCount: content.phrases.length, coreByCategory, errors };
}
