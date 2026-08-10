import type { CefrLevel, SystemContentPackage, SystemContentPhrase } from "../../app/domain/types";
import { BLUEPRINTS, type CategoryBlueprint } from "./catalog";

const VERSION = "2026.08.1";
const GENERATED_AT = "2026-08-10T00:00:00.000Z";
const QUALITY_VERSION = "quality-v1";

function wording(category: CategoryBlueprint["id"], action: string, context: string, variant: number, subcategory: string): string {
  const label = subcategory.replaceAll("-", " ");
  const lead = category === "work" ? `For ${label}, ` : category === "business" ? `Regarding ${label}, ` : category === "supply-chain" ? `For ${label}, ` : category === "social" ? `When it comes to ${label}, ` : "";
  const stems = {
    daily: [`I need to ${action} ${context}.`, `I'm planning to ${action} ${context}.`, `I should ${action} ${context}.`, `I'd like to ${action} ${context}.`],
    travel: [`Could you help me ${action} ${context}?`, `Can you help me ${action} ${context}?`, `I'd appreciate some help to ${action} ${context}.`, `Would you mind helping me ${action} ${context}?`],
    work: [`Let's ${action} ${context}.`, `We should ${action} ${context}.`, `Can we ${action} ${context}?`, `It would help to ${action} ${context}.`],
    business: [`We'd like to ${action} ${context}.`, `Can we ${action} ${context}?`, `Our proposal is to ${action} ${context}.`, `Would you be open to ${action} ${context}?`],
    "supply-chain": [`We need to ${action} ${context}.`, `Could you ${action} ${context}?`, `Our team will ${action} ${context}.`, `It's important to ${action} ${context}.`],
    social: [`I want to ${action} ${context}.`, `I'd like to ${action} ${context}.`, `I'm trying to ${action} ${context}.`, `It matters to me to ${action} ${context}.`],
  } as const;
  const sentence = stems[category][variant];
  const joined = sentence.startsWith("I") ? sentence : `${sentence[0].toLowerCase()}${sentence.slice(1)}`;
  return lead ? `${lead}${joined}` : sentence;
}

function chinese(category: CategoryBlueprint["id"], action: string, context: string, variant: number): string {
  const prefix = variant === 0 ? "我想" : variant === 1 ? "我希望能" : variant === 2 ? "我们可以" : "这次最好";
  return category === "travel" ? `你能帮我${action}${context}吗？` : `${prefix}${action}${context}。`;
}

export function generateSystemContent(): SystemContentPackage {
  const phrases: SystemContentPhrase[] = [];
  let coreIndex = 0;
  for (const blueprint of BLUEPRINTS) {
    for (let familyIndex = 0; familyIndex < blueprint.families.length; familyIndex += 1) {
      const family = blueprint.families[familyIndex];
      for (let actionIndex = 0; actionIndex < family.actions.length; actionIndex += 1) {
        for (let contextIndex = 0; contextIndex < family.contexts.length; contextIndex += 1) {
        const action = family.actions[actionIndex];
        const context = family.contexts[contextIndex];
        const coreId = `sys-${blueprint.id}-${String(familyIndex + 1).padStart(2, "0")}-${actionIndex + 1}-${contextIndex + 1}`;
        const cefrLevel: CefrLevel = coreIndex % 5 === 0 ? "B2" : coreIndex % 2 === 0 ? "B1" : "A2";
        const common = { categoryId: blueprint.id, origin: "system" as const, subcategory: family.subcategory, cefrLevel, intent: family.intent, contentVersion: VERSION, qualityVersion: QUALITY_VERSION };
        phrases.push({ ...common, id: coreId, kind: "core", english: wording(blueprint.id, action.en, context.en, 0, family.subcategory), chinese: chinese(blueprint.id, action.zh, context.zh, 0) });
        const exampleCount = coreIndex < 200 ? 3 : 2;
        for (let order = 1; order <= exampleCount; order += 1) {
          phrases.push({ ...common, id: `${coreId}-e${order}`, kind: "example", parentPhraseId: coreId, unlockOrder: order, english: wording(blueprint.id, action.en, context.en, order, family.subcategory), chinese: chinese(blueprint.id, action.zh, context.zh, order) });
        }
        coreIndex += 1;
      }
    }
    }
  }
  return { format: "phrase-bank-system-content", version: VERSION, generatedAt: GENERATED_AT, qualityVersion: QUALITY_VERSION, phrases };
}
