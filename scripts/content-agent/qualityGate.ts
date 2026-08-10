import { validateSystemContentPackage } from "../../app/domain/systemContent";
import type { SystemContentPackage } from "../../app/domain/types";

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
  if (cores.length !== 600) errors.push(`expected 600 cores, got ${cores.length}`);
  if (content.phrases.length !== 2000) errors.push(`expected 2000 phrases, got ${content.phrases.length}`);
  return { coreCount: cores.length, totalCount: content.phrases.length, coreByCategory, errors };
}
