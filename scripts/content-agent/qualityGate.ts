import { validateSystemContentPackage } from "../../app/domain/systemContent";
import type { SystemContentPackage } from "../../app/domain/types";
import { BLUEPRINTS } from "./catalog";

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
  return { coreCount: cores.length, totalCount: content.phrases.length, coreByCategory, errors };
}
