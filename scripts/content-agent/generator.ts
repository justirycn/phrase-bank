import type { CefrLevel, SystemContentPackage, SystemContentPhrase } from "../../app/domain/types";
import { BLUEPRINTS, type CategoryBlueprint } from "./catalog";

const VERSION = "2026.08.2";
const GENERATED_AT = "2026-08-17T12:30:00.000Z";
const QUALITY_VERSION = "quality-v2";

function wording(category: CategoryBlueprint["id"], action: string, context: string, variant: number, subcategory: string): string {
  const label = subcategory.replaceAll("-", " ");
  const simple = {
    daily: [`I need to ${action} ${context}.`, `I'm planning to ${action} ${context}.`, `I should ${action} ${context}.`, `I'd like to ${action} ${context}.`],
    travel: [`Could you help me ${action} ${context}?`, `Can you help me ${action} ${context}?`, `I'd appreciate some help to ${action} ${context}.`, `Would you mind helping me ${action} ${context}?`],
  } as const;
  if (category === "daily" || category === "travel") return simple[category][variant];
  if (category === "work") return [
    `For ${label}, let's ${action} ${context}.`,
    `We should ${action} ${context} during ${label}.`,
    `Can we ${action} ${context} as part of ${label}?`,
    `It would help ${label} if we ${action} ${context}.`,
  ][variant];
  if (category === "business") return [
    `Regarding ${label}, we'd like to ${action} ${context}.`,
    `Can we ${action} ${context} as part of ${label}?`,
    `Our proposal for ${label} is to ${action} ${context}.`,
    `Would you be open to ${action} ${context} when we discuss ${label}?`,
  ][variant];
  if (category === "supply-chain") return [
    `For ${label}, we need to ${action} ${context}.`,
    `Could you ${action} ${context} as part of ${label}?`,
    `Our team will ${action} ${context} during ${label}.`,
    `It's important to ${action} ${context} before we complete ${label}.`,
  ][variant];
  return [
    `When it comes to ${label}, I want to ${action} ${context}.`,
    `I'd like to ${action} ${context} while we talk about ${label}.`,
    `For ${label}, I'm trying to ${action} ${context}.`,
    `It matters to me to ${action} ${context} when discussing ${label}.`,
  ][variant];
}

function chinese(category: CategoryBlueprint["id"], action: string, context: string, variant: number, subcategoryZh?: string): string {
  const prefix = variant === 0 ? "我想" : variant === 1 ? "我希望能" : variant === 2 ? "我们可以" : "这次最好";
  if (category === "travel") return `你能帮我${action}${context}吗？`;
  if (category === "daily") return `${prefix}${action}${context}。`;
  const label = subcategoryZh ?? "当前事项";
  if (category === "work") return [
    `关于${label}，我们来${action}${context}。`,
    `在${label}中，我们应该${action}${context}。`,
    `作为${label}的一部分，我们可以${action}${context}吗？`,
    `如果我们能为${label}${action}${context}，会很有帮助。`,
  ][variant];
  if (category === "business") return [
    `关于${label}，我们希望${action}${context}。`,
    `在${label}中，我们可以${action}${context}吗？`,
    `我们对${label}的建议是${action}${context}。`,
    `讨论${label}时，你愿意${action}${context}吗？`,
  ][variant];
  if (category === "supply-chain") return [
    `在${label}环节，我们需要${action}${context}。`,
    `作为${label}的一部分，请你${action}${context}好吗？`,
    `在${label}期间，我们的团队会${action}${context}。`,
    `完成${label}前，${action}${context}很重要。`,
  ][variant];
  return [
    `谈到${label}，我想${action}${context}。`,
    `聊${label}时，我希望能${action}${context}。`,
    `关于${label}，我正在努力${action}${context}。`,
    `讨论${label}时，${action}${context}对我很重要。`,
  ][variant];
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
        const coreVariant = coreIndex % 4;
        phrases.push({ ...common, id: coreId, kind: "core", english: wording(blueprint.id, action.en, context.en, coreVariant, family.subcategory), chinese: chinese(blueprint.id, action.zh, context.zh, coreVariant, family.subcategoryZh) });
        const exampleCount = coreIndex < 200 ? 3 : 2;
        for (let order = 1; order <= exampleCount; order += 1) {
          const exampleVariant = (coreVariant + order) % 4;
          phrases.push({ ...common, id: `${coreId}-e${order}`, kind: "example", parentPhraseId: coreId, unlockOrder: order, english: wording(blueprint.id, action.en, context.en, exampleVariant, family.subcategory), chinese: chinese(blueprint.id, action.zh, context.zh, exampleVariant, family.subcategoryZh) });
        }
        coreIndex += 1;
      }
    }
    }
  }
  return { format: "phrase-bank-system-content", version: VERSION, generatedAt: GENERATED_AT, qualityVersion: QUALITY_VERSION, phrases };
}
