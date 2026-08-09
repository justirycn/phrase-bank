import type { BackupEnvelopeV1, BackupEnvelopeV2, TrainingEvent, TrainingSessionRecord } from "../domain/types";

type BackupCandidate = Omit<Partial<BackupEnvelopeV1>, "version"> & {
  version?: 1 | 2;
  trainingEvents?: TrainingEvent[];
  trainingSessions?: TrainingSessionRecord[];
};

export function parseBackup(raw: string): BackupEnvelopeV2 {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("备份文件不是有效的 JSON"); }
  if (!value || typeof value !== "object") throw new Error("备份文件格式不正确");
  const backup = value as BackupCandidate;
  if (backup.format !== "personal-phrase-bank") throw new Error("这不是 Phrase Bank 备份文件");
  if (backup.version !== 1 && backup.version !== 2) throw new Error("不支持的备份版本");
  if (!Array.isArray(backup.categories) || !Array.isArray(backup.phrases) || !Array.isArray(backup.reviewLogs)) throw new Error("备份文件缺少必要数据");
  const categoryIds = new Set(backup.categories.map((category) => category.id));
  if (backup.categories.some((category) => !category.id || !category.name)) throw new Error("备份中的分类数据不完整");
  if (backup.phrases.some((phrase) => !phrase.id || !phrase.english || !phrase.chinese || !categoryIds.has(phrase.categoryId))) throw new Error("备份包含不存在的分类或不完整语言块");
  const phraseIds = new Set(backup.phrases.map((phrase) => phrase.id));
  if (backup.reviewLogs.some((log) => !log.id || !phraseIds.has(log.phraseId))) throw new Error("备份包含无效的复习记录");
  if (backup.version === 1) return { ...backup, version: 2, trainingEvents: [], trainingSessions: [] } as BackupEnvelopeV2;
  if (!Array.isArray(backup.trainingEvents) || !Array.isArray(backup.trainingSessions)) throw new Error("备份文件缺少必要训练数据");
  const validCounter = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0;
  const validDate = (value: unknown) => typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
  const invalidSession = (session: TrainingSessionRecord) => !session.id?.trim()
    || (session.mode !== "quick" && session.mode !== "standard")
    || !validDate(session.startedAt) || !validDate(session.updatedAt)
    || (session.completedAt !== undefined && !validDate(session.completedAt))
    || !Array.isArray(session.phraseIds) || session.phraseIds.some((id) => !phraseIds.has(id))
    || !validCounter(session.currentIndex) || session.currentIndex > session.phraseIds.length
    || !validCounter(session.activeSeconds);
  if (backup.trainingSessions.some(invalidSession)) throw new Error("备份包含无效的训练会话");
  const sessionIds = new Set(backup.trainingSessions.map((session) => session.id));
  const sources = new Set(["due", "weak", "mature", "new", "requeue"]);
  const results = new Set(["again", "hard", "good"]);
  const invalidEvent = (event: TrainingEvent) => !event.id?.trim() || !event.sessionId?.trim() || !sessionIds.has(event.sessionId)
    || !event.phraseId?.trim() || !phraseIds.has(event.phraseId)
    || !sources.has(event.source) || !results.has(event.result)
    || typeof event.usedPronunciationHint !== "boolean" || typeof event.recorded !== "boolean"
    || !validCounter(event.activeSeconds) || !validDate(event.occurredAt);
  if (backup.trainingEvents.some(invalidEvent)) throw new Error("备份包含无效的训练记录");
  return backup as BackupEnvelopeV2;
}

export function backupFileName(now = new Date()) {
  return `phrase-bank-${now.toISOString().slice(0, 10)}.json`;
}
