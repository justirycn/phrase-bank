import type { PhraseInput } from "./types";

export type PhraseErrors = Partial<Record<keyof PhraseInput, string>>;

export function validatePhraseInput(input: PhraseInput): PhraseErrors {
  const errors: PhraseErrors = {};
  if (!input.english.trim()) errors.english = "请输入英文表达";
  if (!input.chinese.trim()) errors.chinese = "请输入中文含义";
  if (!input.categoryId.trim()) errors.categoryId = "请选择分类";
  return errors;
}

export function validateCategoryName(name: string, existingNames: string[]): string | undefined {
  const normalized = name.trim().toLocaleLowerCase();
  if (!normalized) return "请输入分类名称";
  if (existingNames.some((item) => item.trim().toLocaleLowerCase() === normalized)) return "分类名称已存在";
  return undefined;
}
