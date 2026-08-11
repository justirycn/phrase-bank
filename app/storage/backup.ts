import type { BackupEnvelope, BackupEnvelopeV1, BackupEnvelopeV4, LearningSessionRecord, Phrase, PhraseLearningState, ReviewLog, ReviewResult, TrainingEvent, TrainingSessionRecord } from "../domain/types";

type LegacyLearningState = Partial<PhraseLearningState> & Pick<PhraseLearningState, "phraseId">;
type BackupCandidate = Omit<Partial<BackupEnvelopeV1>, "version"> & {
  version?: 1 | 2 | 3 | 4;
  trainingEvents?: TrainingEvent[];
  trainingSessions?: TrainingSessionRecord[];
  phraseLearningStates?: LegacyLearningState[];
  activeSystemContentVersion?: string;
  learningSessions?: LearningSessionRecord[];
};

const validDuration = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const validIndex = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0;
const validDate = (value: unknown): value is string => typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (value: unknown): value is string => typeof value === "string" && dayPattern.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
  && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
const stages = new Set(["unseen", "learning", "learned", "mastered"]);
const results = new Set(["again", "hard", "good"]);

type Evidence = { timestamp: string; id: string; source: "trainingEvent" | "reviewLog"; result: ReviewResult };

const evidenceSourceOrder: Record<Evidence["source"], number> = { trainingEvent: 0, reviewLog: 1 };
const compareEvidence = (left: Evidence, right: Evidence) => left.timestamp.localeCompare(right.timestamp)
  || evidenceSourceOrder[left.source] - evidenceSourceOrder[right.source]
  || left.id.localeCompare(right.id)
  || left.result.localeCompare(right.result);

function resultEvidence(phraseId: string, logs: ReviewLog[], events: TrainingEvent[]) {
  const candidates: Evidence[] = [
    ...events.filter((item) => item.phraseId === phraseId && validDate(item.occurredAt)).map((item) => ({ timestamp: item.occurredAt, id: item.id, source: "trainingEvent" as const, result: item.result })),
    ...logs.filter((item) => item.phraseId === phraseId && validDate(item.reviewedAt)).map((item) => ({ timestamp: item.reviewedAt, id: item.id, source: "reviewLog" as const, result: item.result })),
  ];
  const paired = new Map<string, Evidence>();
  for (const candidate of candidates) {
    const key = `${candidate.timestamp}|${candidate.result}`;
    const current = paired.get(key);
    if (!current || compareEvidence(candidate, current) < 0) paired.set(key, candidate);
  }
  return [...paired.values()].sort(compareEvidence);
}

export function normalizeLegacyLearningState(phrase: Phrase, legacy: LegacyLearningState | undefined, logs: ReviewLog[], events: TrainingEvent[]): PhraseLearningState {
  const evidence = resultEvidence(phrase.id, logs, events);
  const earliest = evidence[0];
  const lastReviewedAt = validDate(phrase.lastReviewedAt) ? phrase.lastReviewedAt : undefined;
  const masteredDates = Array.isArray(legacy?.masteredDates) ? legacy.masteredDates.filter((day): day is string => typeof day === "string") : [];
  const priorLearning = lastReviewedAt !== undefined || phrase.reviewStep > 0 || phrase.masteryLevel > 0 || masteredDates.length > 0
    || legacy?.stage === "learning" || legacy?.stage === "learned" || legacy?.stage === "mastered";
  const firstSeenAt = earliest?.timestamp ?? lastReviewedAt ?? (validDate(legacy?.firstSeenAt)
    ? legacy.firstSeenAt
    : priorLearning ? validDate(legacy?.updatedAt) ? legacy.updatedAt : validDate(phrase.updatedAt) ? phrase.updatedAt : undefined : undefined);
  const firstTestedAt = earliest?.timestamp;
  const firstResult = earliest?.result;
  const stage: PhraseLearningState["stage"] = earliest
    ? phrase.masteryLevel === 3 || masteredDates.length >= 2 ? "mastered" : "learned"
    : firstSeenAt ? "learning" : "unseen";
  const phraseEvents = events
    .filter((event) => event.phraseId === phrase.id && validDate(event.occurredAt))
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id) || left.result.localeCompare(right.result));
  let consecutiveGood = 0;
  for (let index = phraseEvents.length - 1; index >= 0 && phraseEvents[index].result === "good"; index -= 1) consecutiveGood += 1;
  const migrated: PhraseLearningState = {
    ...legacy,
    phraseId: phrase.id,
    stage,
    consecutiveGood,
    masteredDates,
    updatedAt: validDate(legacy?.updatedAt) ? legacy.updatedAt : validDate(phrase.updatedAt) ? phrase.updatedAt : earliest?.timestamp ?? lastReviewedAt ?? phrase.createdAt,
  };
  delete migrated.firstSeenAt;
  delete migrated.firstTestedAt;
  delete migrated.firstResult;
  delete migrated.unlockedAt;
  if (firstSeenAt) migrated.firstSeenAt = firstSeenAt;
  if (firstTestedAt) migrated.firstTestedAt = firstTestedAt;
  if (firstResult) migrated.firstResult = firstResult;
  if (validDate(legacy?.unlockedAt)) migrated.unlockedAt = legacy.unlockedAt;
  return migrated;
}

export function normalizeLegacyBackup(backup: BackupEnvelope): BackupEnvelopeV4 {
  if (backup.version === 4) return backup;
  const phrases = backup.phrases.map((phrase) => ({ origin: "personal", kind: "standalone", ...phrase })) as Phrase[];
  const trainingEvents = backup.version === 1 ? [] : backup.trainingEvents;
  const trainingSessions = backup.version === 1 ? [] : backup.trainingSessions;
  const legacyStates = backup.version === 3 ? backup.phraseLearningStates as LegacyLearningState[] : [];
  const statesByPhrase = new Map(legacyStates.map((state) => [state.phraseId, state]));
  return {
    format: "personal-phrase-bank",
    version: 4,
    exportedAt: backup.exportedAt,
    categories: backup.categories,
    phrases,
    reviewLogs: backup.reviewLogs,
    trainingEvents,
    trainingSessions,
    phraseLearningStates: phrases.map((phrase) => normalizeLegacyLearningState(phrase, statesByPhrase.get(phrase.id), backup.reviewLogs, trainingEvents)),
    learningSessions: [],
    ...(backup.version === 3 && backup.activeSystemContentVersion ? { activeSystemContentVersion: backup.activeSystemContentVersion } : {}),
  };
}

export function validateLearningSession(
  session: LearningSessionRecord,
  references?: { categoryIds: ReadonlySet<string>; phraseIds: ReadonlySet<string> },
) {
  return Boolean(session.id?.trim())
    && validDay(session.date)
    && Boolean(session.themeCategoryId?.trim())
    && (!references || references.categoryIds.has(session.themeCategoryId))
    && Array.isArray(session.phraseIds) && session.phraseIds.length > 0
    && session.phraseIds.every((id) => Boolean(id?.trim()) && (!references || references.phraseIds.has(id)))
    && new Set(session.phraseIds).size === session.phraseIds.length
    && validIndex(session.studyIndex) && session.studyIndex <= session.phraseIds.length
    && validIndex(session.testIndex) && session.testIndex <= session.phraseIds.length
    && (session.phase === "study" || session.phase === "test")
    && validDate(session.startedAt) && validDate(session.updatedAt)
    && (session.completedAt === undefined || validDate(session.completedAt))
    && (session.phase !== "study" || (session.completedAt === undefined && session.testIndex === 0 && session.studyIndex < session.phraseIds.length))
    && (session.phase !== "test" || session.studyIndex === session.phraseIds.length)
    && (session.completedAt === undefined || (session.phase === "test" && session.studyIndex === session.phraseIds.length && session.testIndex === session.phraseIds.length));
}

export function assertValidLearningSession(
  session: LearningSessionRecord,
  references?: { categoryIds: ReadonlySet<string>; phraseIds: ReadonlySet<string> },
) {
  if (!validateLearningSession(session, references)) throw new Error("学习会话无效");
}

function invalidLearningState(state: LegacyLearningState, phraseIds: Set<string>) {
  if (!phraseIds.has(state.phraseId) || !stages.has(state.stage as string)
    || !validIndex(state.consecutiveGood)
    || !Array.isArray(state.masteredDates) || new Set(state.masteredDates).size !== state.masteredDates.length
    || state.masteredDates.some((day) => !validDay(day))
    || !validDate(state.updatedAt) || (state.unlockedAt !== undefined && !validDate(state.unlockedAt))) return true;
  const hasSeen = validDate(state.firstSeenAt);
  const hasTested = validDate(state.firstTestedAt);
  const hasResult = results.has(state.firstResult as string);
  if (state.firstSeenAt !== undefined && !hasSeen) return true;
  if (state.firstTestedAt !== undefined && !hasTested) return true;
  if (state.firstResult !== undefined && !hasResult) return true;
  if (state.stage === "unseen") return state.firstSeenAt !== undefined || state.firstTestedAt !== undefined || state.firstResult !== undefined;
  if (state.stage === "learning") return !hasSeen || state.firstTestedAt !== undefined || state.firstResult !== undefined;
  return !hasSeen || !hasTested || !hasResult;
}

export function parseBackup(raw: string): BackupEnvelopeV4 {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("备份文件不是有效的 JSON"); }
  if (!value || typeof value !== "object") throw new Error("备份文件格式不正确");
  const backup = value as BackupCandidate;
  if (backup.format !== "personal-phrase-bank") throw new Error("这不是 Phrase Bank 备份文件");
  if (backup.version !== 1 && backup.version !== 2 && backup.version !== 3 && backup.version !== 4) throw new Error("不支持的备份版本");
  if (!validDate(backup.exportedAt) || !Array.isArray(backup.categories) || !Array.isArray(backup.phrases) || !Array.isArray(backup.reviewLogs)) throw new Error("备份文件缺少必要数据");
  const categoryIds = new Set(backup.categories.map(({ id }) => id));
  if (backup.categories.some(({ id, name }) => !id || !name)) throw new Error("备份中的分类数据不完整");
  if (backup.phrases.some((phrase) => !phrase.id || !phrase.english || !phrase.chinese || !categoryIds.has(phrase.categoryId))) throw new Error("备份包含不存在的分类或不完整语言块");
  const phrases = backup.phrases.map((phrase) => ({ origin: "personal", kind: "standalone", ...phrase })) as Phrase[];
  const phraseIds = new Set(phrases.map(({ id }) => id));
  const cores = new Set(phrases.filter(({ origin, kind }) => origin === "system" && kind === "core").map(({ id }) => id));
  const invalidHierarchy = phrases.some((phrase) => {
    if (phrase.origin === "personal") return phrase.kind !== "standalone" || phrase.parentPhraseId !== undefined || phrase.unlockOrder !== undefined;
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

  const learningSessions = backup.version === 4 ? backup.learningSessions : [];
  if (!Array.isArray(learningSessions)) throw new Error("备份缺少学习会话");
  const references = { categoryIds, phraseIds };
  if (learningSessions.some((session) => !validateLearningSession(session, references)) || new Set(learningSessions.map(({ id }) => id)).size !== learningSessions.length) throw new Error("备份包含无效的学习会话");
  if (learningSessions.filter(({ completedAt }) => completedAt === undefined).length > 1) throw new Error("备份包含多个进行中的学习会话");

  const sessionIds = new Set([...trainingSessions.map(({ id }) => id), ...learningSessions.map(({ id }) => id)]);
  const invalidEvent = (event: TrainingEvent) => !event.id?.trim() || !event.sessionId?.trim() || !sessionIds.has(event.sessionId)
    || !event.phraseId?.trim() || !phraseIds.has(event.phraseId) || !sources.has(event.source) || !results.has(event.result)
    || typeof event.usedPronunciationHint !== "boolean" || typeof event.recorded !== "boolean"
    || !validDuration(event.activeSeconds) || !validDate(event.occurredAt);
  if (trainingEvents.some(invalidEvent)) throw new Error("备份包含无效的训练记录");

  let phraseLearningStates: PhraseLearningState[];
  if (backup.version === 4) {
    if (!Array.isArray(backup.phraseLearningStates)) throw new Error("备份缺少学习状态");
    phraseLearningStates = backup.phraseLearningStates as PhraseLearningState[];
    if (phraseLearningStates.some((state) => invalidLearningState(state, phraseIds))
      || new Set(phraseLearningStates.map(({ phraseId }) => phraseId)).size !== phraseLearningStates.length) throw new Error("备份包含无效学习状态");
  } else if (backup.version === 3) {
    if (!Array.isArray(backup.phraseLearningStates)) throw new Error("备份缺少学习状态");
    if (backup.phraseLearningStates.some((state) => !phraseIds.has(state.phraseId)
      || !Array.isArray(state.masteredDates) || new Set(state.masteredDates).size !== state.masteredDates.length
      || state.masteredDates.some((day) => !validDay(day))
      || !validDate(state.updatedAt) || (state.unlockedAt !== undefined && !validDate(state.unlockedAt)))) throw new Error("备份包含无效学习状态");
    phraseLearningStates = [];
  } else {
    phraseLearningStates = [];
  }

  if (backup.version !== 4) {
    return normalizeLegacyBackup({ ...backup, phrases, trainingEvents, trainingSessions } as BackupEnvelope);
  }

  return {
    format: "personal-phrase-bank", version: 4, exportedAt: backup.exportedAt,
    categories: backup.categories, phrases, reviewLogs: backup.reviewLogs,
    trainingEvents, trainingSessions, phraseLearningStates, learningSessions,
    ...(backup.version >= 3 && backup.activeSystemContentVersion ? { activeSystemContentVersion: backup.activeSystemContentVersion } : {}),
  };
}

export function backupFileName(now = new Date()) {
  return `phrase-bank-${now.toISOString().slice(0, 10)}.json`;
}
