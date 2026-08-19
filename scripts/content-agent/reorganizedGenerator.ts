import type { CefrLevel, SystemContentPackage, SystemContentPhrase } from "../../app/domain/types";
import { REORGANIZED_CATEGORY_PLAN, REORGANIZED_CONTENT_VERSION } from "./reorganizedCatalog";

const SOURCE_QUALITY_VERSION = "reorganized-brief-v1";
const SOURCE_GENERATED_AT = "2026-08-19T00:00:00.000Z";

function sourcePhrase(input: {
  id: string;
  categoryId: string;
  subcategory: string;
  intent: string;
  cefrLevel: CefrLevel;
  kind: "core" | "example";
  parentPhraseId?: string;
  unlockOrder?: number;
}): SystemContentPhrase {
  const brief = input.kind === "core"
    ? `Write one common spoken-English phrase that can ${input.intent} in ${input.subcategory.replaceAll("-", " ")}.`
    : `Transfer "${input.intent}" to a different realistic situation in ${input.subcategory.replaceAll("-", " ")}; example ${input.unlockOrder}.`;
  return {
    ...input,
    origin: "system",
    english: brief,
    chinese: input.kind === "core" ? `为“${input.subcategory}”场景创作一句能“${input.intent}”的自然高频口语。` : `把“${input.intent}”的沟通功能迁移到“${input.subcategory}”之外的不同真实场景，案例 ${input.unlockOrder}。`,
    contentVersion: REORGANIZED_CONTENT_VERSION,
    qualityVersion: SOURCE_QUALITY_VERSION,
  };
}

export function generateReorganizedContentSource(): SystemContentPackage {
  const phrases: SystemContentPhrase[] = [];
  for (const category of REORGANIZED_CATEGORY_PLAN) {
    if (category.subcategories.length * category.goals.length !== category.coreQuota) {
      throw new Error(`${category.id} content plan does not match its core quota`);
    }
    category.subcategories.forEach((subcategory, familyIndex) => {
      const exampleCount = familyIndex < category.threeExampleFamilies ? 3 : 2;
      category.goals.forEach((goal, goalIndex) => {
        const id = `sys-v4-${category.id}-${String(familyIndex + 1).padStart(2, "0")}-${String(goalIndex + 1).padStart(2, "0")}`;
        const cefrLevel: CefrLevel = goalIndex < 4 ? "A2" : goalIndex < 8 ? "B1" : "B2";
        const intent = `${goal} in ${subcategory.replaceAll("-", " ")}`;
        phrases.push(sourcePhrase({ id, categoryId: category.id, subcategory, intent, cefrLevel, kind: "core" }));
        for (let order = 1; order <= exampleCount; order += 1) {
          phrases.push(sourcePhrase({ id: `${id}-e${order}`, categoryId: category.id, subcategory, intent, cefrLevel, kind: "example", parentPhraseId: id, unlockOrder: order }));
        }
      });
    });
  }
  return {
    format: "phrase-bank-system-content",
    version: REORGANIZED_CONTENT_VERSION,
    generatedAt: SOURCE_GENERATED_AT,
    qualityVersion: SOURCE_QUALITY_VERSION,
    phrases,
  };
}
