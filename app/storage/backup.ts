import type { BackupEnvelope } from "../domain/types";

export function parseBackup(raw: string): BackupEnvelope {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("备份文件不是有效的 JSON"); }
  if (!value || typeof value !== "object") throw new Error("备份文件格式不正确");
  const backup = value as Partial<BackupEnvelope>;
  if (backup.format !== "personal-phrase-bank") throw new Error("这不是 Phrase Bank 备份文件");
  if (backup.version !== 1) throw new Error("不支持的备份版本");
  if (!Array.isArray(backup.categories) || !Array.isArray(backup.phrases) || !Array.isArray(backup.reviewLogs)) throw new Error("备份文件缺少必要数据");
  const categoryIds = new Set(backup.categories.map((category) => category.id));
  if (backup.categories.some((category) => !category.id || !category.name)) throw new Error("备份中的分类数据不完整");
  if (backup.phrases.some((phrase) => !phrase.id || !phrase.english || !phrase.chinese || !categoryIds.has(phrase.categoryId))) throw new Error("备份包含不存在的分类或不完整语言块");
  const phraseIds = new Set(backup.phrases.map((phrase) => phrase.id));
  if (backup.reviewLogs.some((log) => !log.id || !phraseIds.has(log.phraseId))) throw new Error("备份包含无效的复习记录");
  return backup as BackupEnvelope;
}

export function backupFileName(now = new Date()) {
  return `phrase-bank-${now.toISOString().slice(0, 10)}.json`;
}
