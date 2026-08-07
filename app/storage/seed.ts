import type { Category } from "../domain/types";

const names = [
  ["daily", "日常"], ["travel", "旅行"], ["business", "商务"], ["supply-chain", "供应链"],
  ["opinions", "观点表达"], ["social", "聊天社交"], ["emotions", "情绪表达"], ["fitness", "健身"],
] as const;

export function defaultCategories(now = new Date()): Category[] {
  const timestamp = now.toISOString();
  return names.map(([id, name]) => ({ id, name, isDefault: true, createdAt: timestamp, updatedAt: timestamp }));
}
