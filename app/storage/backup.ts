import type { BackupEnvelopeV1, BackupEnvelopeV3, Phrase, PhraseLearningState, TrainingEvent, TrainingSessionRecord } from "../domain/types";

type BackupCandidate = Omit<Partial<BackupEnvelopeV1>, "version"> & {
  version?: 1 | 2 | 3;
  trainingEvents?: TrainingEvent[];
  trainingSessions?: TrainingSessionRecord[];
  phraseLearningStates?: PhraseLearningState[];
  activeSystemContentVersion?: string;
};

const validDuration = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const validIndex = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0;
const validDate = (value: unknown) => typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));

export function parseBackup(raw: string): BackupEnvelopeV3 {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("备份文件不是有效的 JSON"); }
  if (!value || typeof value !== "object") throw new Error("备份文件格式不正确");
  const backup = value as BackupCandidate;
  if (backup.format !== "personal-phrase-bank") throw new Error("这不是 Phrase Bank 备份文件");
  if (backup.version !== 1 && backup.version !== 2 && backup.version !== 3) throw new Error("不支持的备份版本");
  if (!validDate(backup.exportedAt) || !Array.isArray(backup.categories) || !Array.isArray(backup.phrases) || !Array.isArray(backup.reviewLogs)) throw new Error("备份文件缺少必要数据");
  const categoryIds = new Set(backup.categories.map(({ id }) => id));
  if (backup.categories.some(({ id, name }) => !id || !name)) throw new Error("备份中的分类数据不完整");
  if (backup.phrases.some((phrase) => !phrase.id || !phrase.english || !phrase.chinese || !categoryIds.has(phrase.categoryId))) throw new Error("备份包含不存在的分类或不完整语言块");
  const phrases = backup.phrases.map((phrase) => ({ origin: "personal", kind: "standalone", ...phrase })) as Phrase[];
  const phraseIds = new Set(phrases.map(({ id }) => id));
  const cores = new Set(phrases.filter(({ origin, kind }) => origin === "system" && kind === "core").map(({ id }) => id));
  const invalidHierarchy = phrases.some((phrase) => {
    if (phrase.origin === "personal") return phrase.kind !== "standalone";
    if (phrase.origin !== "system" || (phrase.kind !== "core" && phrase.kind !== "example")) return true;
    if (phrase.kind === "core") return phrase.parentPhraseId !== undefined || phrase.unlockOrder !== undefined;
    return !phrase.parentPhraseId || !cores.has(phrase.parentPhraseId) || !Number.isInteger(phrase.unlockOrder) || (phrase.unlockOrder ?? 0) < 1;
  });
  if (invalidHierarchy) throw new Error("备份包含无效内容层级");
  if (backup.reviewLogs.some((log) => !log.id || !phraseIds.has(log.phraseId))) throw new Error("备份包含无效的复习记录");

  const trainingEvents = backup.version === 1 ? [] : backup.trainingEvents;
  const trainingSessions = backup.version === 1 ? [] : backup.trainingSessions;
  if (!Array.isArray(trainingEvents) || !Array.isArray(trainingSessions)) throw new Error("备份文件缺少必要训练数据");
  const sources = new Set(["due", "weak", "mature", "new", "requeue"]);
  const invalidSession = (session: TrainingSessionRecord) => !session.id?.trim()
    || (session.mode !== "quick" && session.mode !== "standard")
    || !validDate(session.startedAt) || !validDate(session.updatedAt)
    || (session.completedAt !== undefined && !validDate(session.completedAt))
    || !Array.isArray(session.phraseIds) || session.phraseIds.some((id) => !phraseIds.has(id))
    || (session.sources !== undefined && (!Array.isArray(session.sources) || session.sources.length !== session.phraseIds.length || session.sources.some((source) => !sources.has(source))))
    || !validIndex(session.currentIndex) || session.currentIndex > session.phraseIds.length
    || !validDuration(session.activeSeconds);
  if (trainingSessions.some(invalidSession)) throw new Error("备份包含无效的训练会话");
  const sessionIds = new Set(trainingSessions.map(({ id }) => id));
  const results = new Set(["again", "hard", "good"]);
  const invalidEvent = (event: TrainingEvent) => !event.id?.trim() || !event.sessionId?.trim() || !sessionIds.has(event.sessionId)
    || !event.phraseId?.trim() || !phraseIds.has(event.phraseId) || !sources.has(event.source) || !results.has(event.result)
    || typeof event.usedPronunciationHint !== "boolean" || typeof event.recorded !== "boolean"
    || !validDuration(event.activeSeconds) || !validDate(event.occurredAt);
  if (trainingEvents.some(invalidEvent)) throw new Error("备份包含无效的训练记录");

  const phraseLearningStates = backup.version === 3 ? backup.phraseLearningStates : [];
  if (!Array.isArray(phraseLearningStates)) throw new Error("备份缺少学习状态");
  const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
  if (phraseLearningStates.some((state) => !phraseIds.has(state.phraseId)
    || !Array.isArray(state.masteredDates) || new Set(state.masteredDates).size !== state.masteredDates.length
    || state.masteredDates.some((day) => !dayPattern.test(day)) || !validDate(state.updatedAt)
    || (state.unlockedAt !== undefined && !validDate(state.unlockedAt)))) throw new Error("备份包含无效学习状态");

  return {
    format: "personal-phrase-bank", version: 3, exportedAt: backup.exportedAt,
    categories: backup.categories, phrases, reviewLogs: backup.reviewLogs,
    trainingEvents, trainingSessions, phraseLearningStates,
    activeSystemContentVersion: backup.version === 3 ? backup.activeSystemContentVersion : undefined,
  };
}

export function backupFileName(now = new Date()) {
  return `phrase-bank-${now.toISOString().slice(0, 10)}.json`;
}
