import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PhraseBankApp, submitReviewForCurrentRepository } from "../../app/PhraseBankApp";
import type { AppPreferences, BackupEnvelopeV5, Category, LearningSessionPurpose, Phrase, PhraseLearningState, ReviewResult, SpeechPreferences, TrainingEvent, TrainingSessionRecord } from "../../app/domain/types";
import { isReviewDueOnShanghaiDay } from "../../app/domain/review";

class MemoryRepository {
  phrases: Phrase[] = [];
  initializeAttempts = 0;
  initializePromise?: Promise<void>;
  failInitialize = false;
  failPhraseReads = false;
  failPhraseSave = false;
  phraseSaveAttempts = 0;
  failLearningStateSave = false;
  savePhraseImpl?: (phrase: Phrase) => Promise<void>;
  phraseReadPromise?: Promise<Phrase[]>;
  phraseReadAttempts = 0;
  categories: Category[] = [{ id: "daily", name: "日常", isDefault: true, createdAt: "2026-08-07T00:00:00.000Z", updatedAt: "2026-08-07T00:00:00.000Z" }];
  async initialize() { this.initializeAttempts += 1; if (this.initializePromise) await this.initializePromise; if (this.failInitialize) throw new Error("initialize failed"); }
  async listPhrases() { this.phraseReadAttempts += 1; if (this.phraseReadPromise) return this.phraseReadPromise; if (this.failPhraseReads) throw new Error("db failed"); return [...this.phrases]; }
  async listCategories() { return [...this.categories]; }
  async listDuePhrases(now = new Date()) { return this.phrases.filter((phrase) => isReviewDueOnShanghaiDay(phrase.nextReviewAt, now)); }
  async savePhrase(phrase: Phrase) { this.phraseSaveAttempts += 1; if (this.savePhraseImpl) return this.savePhraseImpl(phrase); if (this.failPhraseSave) throw new Error("save failed"); this.phrases = [...this.phrases.filter((p) => p.id !== phrase.id), phrase]; }
  async deletePhrase(id: string) { this.phrases = this.phrases.filter((p) => p.id !== id); }
  async submitReview(id: string, result: ReviewResult, now?: Date, operationId?: string) { void id; void result; void now; void operationId; }
  events: TrainingEvent[] = [];
  eventReadPromise?: Promise<TrainingEvent[]>;
  sessions: TrainingSessionRecord[] = [];
  exportSnapshotAttempts = 0;
  failTrainingEventReads = false;
  preferences: SpeechPreferences = { accent: "en-US", autoSpeak: false };
  failPreferenceLoad = false;
  failPreferenceSave = false;
  preferenceSaves: SpeechPreferences[] = [];
  learningStates: PhraseLearningState[] = [];
  learningSessions: import("../../app/domain/types").LearningSessionRecord[] = [];
  preferenceLoad?: Promise<SpeechPreferences>;
  savePreferenceImpl?: (value: SpeechPreferences) => Promise<void>;
  appPreferences: AppPreferences = { dailyMasteryGoal: 10, dailyNewPhraseGoal: 10 };
  appPreferenceSaves: AppPreferences[] = [];
  failAppPreferenceSave = false;
  async getPhrase(id: string) { return this.phrases.find((phrase) => phrase.id === id); }
  async submitTrainingReview(event: TrainingEvent) {
    this.events.push(event);
    this.phrases = this.phrases.map((phrase) => phrase.id === event.phraseId
      ? { ...phrase, nextReviewAt: "2099-01-01T00:00:00.000Z" }
      : phrase);
  }
  async saveTrainingEvent(event: TrainingEvent) { this.events = [...this.events.filter((item) => item.id !== event.id), event]; }
  async listTrainingEvents() { if (this.eventReadPromise) return this.eventReadPromise; if (this.failTrainingEventReads) throw new Error("event read failed"); return [...this.events]; }
  async listTrainingSessions() { return [...this.sessions]; }
  async saveTrainingSession(session: TrainingSessionRecord) { this.sessions = [...this.sessions.filter((item) => item.id !== session.id), session]; }
  async getActiveTrainingSession() { return this.sessions.find((session) => !session.completedAt); }
  async completeTrainingSession(id: string, completedAt: Date) { this.sessions = this.sessions.map((session) => session.id === id ? { ...session, completedAt: completedAt.toISOString() } : session); }
  async getSpeechPreferences() { if (this.preferenceLoad) return this.preferenceLoad; if (this.failPreferenceLoad) throw new Error("preference load failed"); return this.preferences; }
  async saveSpeechPreferences(value: SpeechPreferences) { this.preferenceSaves.push(value); if (this.savePreferenceImpl) return this.savePreferenceImpl(value); if (this.failPreferenceSave) throw new Error("preference save failed"); this.preferences = value; }
  async getAppPreferences() { return this.appPreferences; }
  async saveAppPreferences(value: AppPreferences) { this.appPreferenceSaves.push(value); if (this.failAppPreferenceSave) throw new Error("app preference save failed"); this.appPreferences = value; }
  async listPhraseLearningStates() { return [...this.learningStates]; }
  async getPhraseLearningState(id: string) { return this.learningStates.find((state) => state.phraseId === id); }
  async savePhraseLearningState(state: PhraseLearningState) { if (this.failLearningStateSave) throw new Error("state failed"); this.learningStates = [...this.learningStates.filter((item) => item.phraseId !== state.phraseId), state]; }
  async saveLearningSession(session: import("../../app/domain/types").LearningSessionRecord) { this.learningSessions = [...this.learningSessions.filter((item) => item.id !== session.id), session]; }
  async getActiveLearningSession(purpose: LearningSessionPurpose) { return this.learningSessions.find((session) => session.purpose === purpose && !session.completedAt); }
  async completeLearningSession(id: string, completedAt: Date) { this.learningSessions = this.learningSessions.map((session) => session.id === id ? { ...session, completedAt: completedAt.toISOString() } : session); }
  async submitFirstLearningReview(event: TrainingEvent, nextSession: import("../../app/domain/types").LearningSessionRecord) {
    this.events.push(event); await this.saveLearningSession(nextSession);
    const current = this.learningStates.find((state) => state.phraseId === event.phraseId);
    await this.savePhraseLearningState({ phraseId: event.phraseId, stage: "learned", firstSeenAt: current?.firstSeenAt ?? event.occurredAt, firstTestedAt: current?.firstTestedAt ?? event.occurredAt, firstResult: current?.firstResult ?? event.result, consecutiveGood: 0, masteredDates: [], updatedAt: event.occurredAt });
  }
  async getActiveSystemContentVersion() { return undefined; }
  async installSystemContentPackage() {}
  async rollbackSystemContentPackage() {}
  async saveCategory(category: Category) { this.categories.push(category); }
  async deleteCategoryAndMigrate() {}
  async exportSnapshot(): Promise<BackupEnvelopeV5> { this.exportSnapshotAttempts += 1; return { format: "personal-phrase-bank", version: 5, exportedAt: new Date().toISOString(), categories: this.categories, phrases: this.phrases, reviewLogs: [], trainingEvents: this.events, trainingSessions: this.sessions, phraseLearningStates: this.learningStates, learningSessions: this.learningSessions, appPreferences: this.appPreferences }; }
  async importSnapshot() {}
}

function makePhrase(overrides: Partial<Phrase> = {}): Phrase {
  const now = new Date().toISOString();
  return {
    id: "p1",
    english: "I'll get back to you.",
    chinese: "我会回复你的。",
    categoryId: "daily",
    reviewStep: 0,
    masteryLevel: 0,
    nextReviewAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function learnedState(phraseId: string): PhraseLearningState {
  const now = new Date().toISOString();
  return { phraseId, stage: "learned", consecutiveGood: 0, masteredDates: [], updatedAt: now };
}

function threeMasteryDatesEndingOn(day: string): string[] {
  const end = new Date(`${day}T00:00:00.000Z`);
  return [-2, -1, 0].map((offset) => {
    const date = new Date(end);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  });
}

function markDailyTaskComplete(repo: MemoryRepository) {
  const occurredAt = new Date().toISOString();
  repo.events.push(...Array.from({ length: repo.appPreferences.dailyNewPhraseGoal }, (_, index): TrainingEvent => ({
    id: `daily-complete-${index}`, sessionId: "daily-complete", phraseId: `daily-complete-${index}`,
    source: "new", result: "good", usedPronunciationHint: false, recorded: false, activeSeconds: 0, occurredAt,
  })));
}

function activeLearningSession(
  purpose: LearningSessionPurpose,
  phraseIds: string[],
): import("../../app/domain/types").LearningSessionRecord {
  const now = new Date().toISOString();
  return {
    id: `${purpose}-active`, purpose, date: "2026-08-15", themeCategoryId: "daily", phraseIds,
    studyIndex: 0, testIndex: 0, phase: "study", startedAt: now, updatedAt: now,
  };
}

describe("PhraseBankApp", () => {
  it("keeps replacement review loading until repository B data is ready, then starts at B's first phrase", async () => {
    const user = userEvent.setup();
    let resolveOldGrade!: () => void;
    let resolveNewPhrases!: (phrases: Phrase[]) => void;
    const oldRepository = new MemoryRepository();
    const newRepository = new MemoryRepository();
    const oldPhrase = makePhrase({ id: "old-a", chinese: "旧仓库 A" });
    const newPhrase = makePhrase({ id: "new-b", chinese: "新仓库 B" });
    oldRepository.phrases = [oldPhrase];
    oldRepository.learningStates = [learnedState(oldPhrase.id)];
    oldRepository.submitReview = vi.fn(() => new Promise<void>((resolve) => { resolveOldGrade = resolve; }));
    newRepository.phrases = [newPhrase];
    newRepository.learningStates = [learnedState(newPhrase.id)];
    newRepository.phraseReadPromise = new Promise<Phrase[]>((resolve) => { resolveNewPhrases = resolve; });
    const view = render(<PhraseBankApp repository={oldRepository as never} initialScreen="review" />);
    expect(await screen.findByText("旧仓库 A")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "显示英文答案" }));
    await user.click(screen.getByRole("button", { name: /掌握/ }));

    view.rerender(<PhraseBankApp repository={newRepository as never} initialScreen="review" />);
    expect(screen.getByRole("status", { name: /正在打开训练/ })).toBeVisible();
    expect(screen.queryByText(/今天完成了/)).not.toBeInTheDocument();
    resolveOldGrade();
    await Promise.resolve();
    expect(screen.queryByText(/今天完成了/)).not.toBeInTheDocument();

    resolveNewPhrases([newPhrase]);
    expect(await screen.findByText("新仓库 B")).toBeVisible();
    expect(screen.queryByText("旧仓库 A")).not.toBeInTheDocument();
    expect(oldRepository.submitReview).toHaveBeenCalledTimes(1);
    expect(newRepository.phraseReadAttempts).toBe(1);
  });

  it("does not refresh or authorize advancement when an old repository grade settles after replacement", async () => {
    let resolveOld!: () => void;
    const oldRepository = new MemoryRepository();
    const newRepository = new MemoryRepository();
    oldRepository.submitReview = vi.fn(() => new Promise<void>((resolve) => { resolveOld = resolve; }));
    const refresh = vi.fn(async () => undefined);
    let current = { repository: oldRepository, generation: 0 };
    const pending = submitReviewForCurrentRepository(
      oldRepository as never, 0, () => current as never, refresh, "old-a", "good", "old-operation",
    );

    current = { repository: newRepository, generation: 1 };
    resolveOld();

    await expect(pending).rejects.toThrow("复习仓库已更换");
    expect(refresh).not.toHaveBeenCalled();
    expect(newRepository.phrases).toHaveLength(0);
  });

  it("rejects advancement when the repository changes while the original refresh is pending", async () => {
    let resolveRefresh!: () => void;
    const oldRepository = new MemoryRepository();
    const newRepository = new MemoryRepository();
    const refresh = vi.fn(() => new Promise<void>((resolve) => { resolveRefresh = resolve; }));
    let current = { repository: oldRepository, generation: 0 };
    const pending = submitReviewForCurrentRepository(
      oldRepository as never, 0, () => current as never, refresh, "old-a", "good", "old-operation",
    );
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

    current = { repository: newRepository, generation: 1 };
    resolveRefresh();

    await expect(pending).rejects.toThrow("复习仓库已更换");
  });

  it("waits for storage initialization before reading home data", async () => {
    let resolveInitialize!: () => void;
    const repo = new MemoryRepository();
    repo.initializePromise = new Promise<void>((resolve) => { resolveInitialize = resolve; });

    render(<PhraseBankApp repository={repo as never} />);

    expect(await screen.findByText("正在打开你的语言块…")).toBeVisible();
    expect(repo.phraseReadAttempts).toBe(0);
    expect(repo.exportSnapshotAttempts).toBe(0);
    resolveInitialize();
    expect(await screen.findByRole("region", { name: "最近 12 周学习足迹" })).toBeVisible();
    expect(repo.phraseReadAttempts).toBe(1);
    expect(repo.exportSnapshotAttempts).toBe(0);
  });

  it("shows a recoverable initial error without home reads when storage initialization fails", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository();
    repo.failInitialize = true;

    render(<PhraseBankApp repository={repo as never} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("本地数据暂时无法打开，请刷新后重试。initialize failed");
    expect(repo.phraseReadAttempts).toBe(0);
    expect(repo.exportSnapshotAttempts).toBe(0);
    repo.failInitialize = false;
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByRole("region", { name: "最近 12 周学习足迹" })).toBeVisible();
    expect(repo.initializeAttempts).toBe(2);
    expect(repo.phraseReadAttempts).toBe(1);
  });

  it("loads the home screen and learning heatmap without exporting a full snapshot", async () => {
    const repo = new MemoryRepository();
    repo.events.push({ id: "heatmap-event", sessionId: "s1", phraseId: "p1", source: "due", result: "good", usedPronunciationHint: false, recorded: false, activeSeconds: 10, occurredAt: new Date().toISOString() });

    render(<PhraseBankApp repository={repo as never} />);

    expect(await screen.findByRole("region", { name: "最近 12 周学习足迹" })).toBeVisible();
    expect(repo.exportSnapshotAttempts).toBe(0);
  });

  it("keeps home actions usable when the heatmap read fails and retries only the heatmap", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository();
    repo.failTrainingEventReads = true;
    repo.phrases = [makePhrase()];
    repo.learningStates = [learnedState("p1")];
    render(<PhraseBankApp repository={repo as never} />);

    expect(await screen.findByText("学习足迹暂时无法加载")).toBeVisible();
    expect(screen.getByRole("button", { name: /自主学习/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /继续今日任务/ })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /三分钟速练/ })).not.toBeInTheDocument();

    repo.failTrainingEventReads = false;
    repo.events.push({ id: "retry-event", sessionId: "s1", phraseId: "p1", source: "due", result: "good", usedPronunciationHint: false, recorded: false, activeSeconds: 10, occurredAt: new Date().toISOString() });
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByRole("region", { name: "最近 12 周学习足迹" })).toBeVisible();
    expect(screen.queryByText("学习足迹暂时无法加载")).not.toBeInTheDocument();
    expect(repo.exportSnapshotAttempts).toBe(0);
  });

  it("counts and reviews only due phrases that are learned or mastered", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository();
    repo.phrases = [
      makePhrase({ id: "missing", english: "Missing state" }),
      makePhrase({ id: "unseen", english: "Unseen due" }),
      makePhrase({ id: "learning", english: "Learning due" }),
      makePhrase({ id: "learned", english: "Learned due", chinese: "已学习提示" }),
      makePhrase({ id: "mastered", english: "Mastered due", chinese: "已掌握提示" }),
    ];
    repo.learningStates = [
      { ...learnedState("unseen"), stage: "unseen" },
      { ...learnedState("learning"), stage: "learning" },
      learnedState("learned"),
      { ...learnedState("mastered"), stage: "mastered" },
    ];
    render(<PhraseBankApp repository={repo as never} />);
    const review = await screen.findByRole("button", { name: /继续今日任务/ });
    expect(review).toHaveTextContent("到期复习 2 句 · 今日新句 0 / 10");
    await user.click(review);
    expect(await screen.findByText("已学习提示")).toBeVisible();
    expect(screen.getByText(/第\s*1\s*\/\s*2\s*个/)).toBeVisible();
    expect(screen.queryByText("Missing state")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看英文答案并自评" }));
    await user.click(screen.getByRole("button", { name: /掌握/ }));
    expect(await screen.findByText("已掌握提示")).toBeVisible();
    expect(screen.getByText(/第\s*2\s*\/\s*2\s*个/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "查看英文答案并自评" }));
    await user.click(screen.getByRole("button", { name: /掌握/ }));
    expect(await screen.findByText("今日任务 · 新句学习")).toBeVisible();
  });

  it("opens a learned phrase scheduled later on the same Shanghai day", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-14T02:00:00.000Z"));
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const repo = new MemoryRepository();
      repo.phrases = [makePhrase({
        id: "later-today",
        english: "Later today",
        chinese: "今天按自然日复习",
        nextReviewAt: "2026-08-14T12:00:00.000Z",
      })];
      repo.learningStates = [learnedState("later-today")];

      render(<PhraseBankApp repository={repo as never} />);
      const review = await screen.findByRole("button", { name: /继续今日任务/ });
      expect(review).toHaveTextContent("到期复习 1 句 · 今日新句 0 / 10");
      await user.click(review);
      expect(await screen.findByText("今天按自然日复习")).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows exactly separate daily review and autonomous learning entries without quick practice", async () => {
    const repo = new MemoryRepository();
    repo.phrases = [
      makePhrase({ id: "new", origin: "system", kind: "core" }),
      makePhrase({ id: "learned", origin: "personal", kind: "standalone" }),
    ];
    repo.learningStates = [learnedState("learned")];
    render(<PhraseBankApp repository={repo as never} />);
    expect(await screen.findByRole("button", { name: /自主学习/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /自主学习/ })).toHaveTextContent("完成今日任务后开放");
    expect(screen.getByRole("button", { name: /继续今日任务/ })).toHaveTextContent("到期复习 1 句 · 今日新句 0 / 10");
    expect(screen.queryByRole("button", { name: /三分钟速练/ })).not.toBeInTheDocument();
  });

  it("previews the same rotated system theme and count that learning starts", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date("2026-08-10T08:00:00.000Z"));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime }); const repo = new MemoryRepository();
    repo.categories.push(
      { id: "travel", name: "旅行", isDefault: false, createdAt: "2026-08-07T00:00:00.000Z", updatedAt: "2026-08-07T00:00:00.000Z" },
      { id: "work", name: "工作", isDefault: false, createdAt: "2026-08-07T00:00:00.000Z", updatedAt: "2026-08-07T00:00:00.000Z" },
    );
    repo.phrases = [
      makePhrase({ id: "daily-system", categoryId: "daily", origin: "system", kind: "core" }),
      makePhrase({ id: "travel-system", categoryId: "travel", origin: "system", kind: "core" }),
      makePhrase({ id: "work-system", english: "Work preview", categoryId: "work", origin: "system", kind: "core" }),
      makePhrase({ id: "personal", categoryId: "daily", origin: "personal", kind: "standalone" }),
    ];
    markDailyTaskComplete(repo);
    render(<PhraseBankApp repository={repo as never} />);
    const entry = await screen.findByRole("button", { name: /自主学习/ });
    expect(entry).toHaveTextContent("开始学习 4 句 · 工作");
    await user.click(entry);
    await vi.waitFor(() => expect(repo.learningSessions[0]).toMatchObject({ themeCategoryId: "work", phraseIds: expect.any(Array) }));
    expect(repo.learningSessions[0].phraseIds).toHaveLength(4);
    vi.useRealTimers();
  });

  it("shows and restores an active group even when today's limit is reached", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository(); const now = new Date().toISOString();
    repo.phrases = [makePhrase({ id: "active-a" }), makePhrase({ id: "active-b" })];
    repo.learningStates = Array.from({ length: 15 }, (_, index) => ({ ...learnedState(`done-${index}`), firstTestedAt: now }));
    repo.learningSessions = [{ id: "active", purpose: "autonomous", date: "2026-08-10", themeCategoryId: "daily", phraseIds: ["active-a", "active-b"], studyIndex: 0, testIndex: 0, phase: "study", startedAt: now, updatedAt: now }];
    markDailyTaskComplete(repo);
    render(<PhraseBankApp repository={repo as never} />);
    const entry = await screen.findByRole("button", { name: /自主学习/ });
    expect(entry).toHaveTextContent("继续上次 · 剩余 2 句");
    expect(screen.getByRole("button", { name: /继续今日任务/ })).toBeDisabled();
    await user.click(entry);
    expect(await screen.findByText("I'll get back to you.")).toBeVisible();
  });

  it("opens daily new-phrase learning directly when no review is due", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository();
    repo.appPreferences = { dailyMasteryGoal: 10, dailyNewPhraseGoal: 1 };
    repo.phrases = [makePhrase({ id: "daily-new", english: "Daily new phrase", origin: "system", kind: "core", nextReviewAt: "2099-01-01T00:00:00.000Z" })];

    render(<PhraseBankApp repository={repo as never} />);
    await user.click(await screen.findByRole("button", { name: /继续今日任务/ }));

    expect(await screen.findByText("今日任务 · 新句学习")).toBeVisible();
    expect(screen.getByText("Daily new phrase")).toBeVisible();
    expect(repo.learningSessions[0]).toMatchObject({ purpose: "daily" });
  });

  it("resumes the daily checkpoint without consuming the autonomous checkpoint", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository(); const now = new Date().toISOString();
    repo.appPreferences = { dailyMasteryGoal: 10, dailyNewPhraseGoal: 2 };
    repo.phrases = [
      makePhrase({ id: "daily-a", english: "Daily first", nextReviewAt: "2099-01-01T00:00:00.000Z" }),
      makePhrase({ id: "daily-b", english: "Daily cursor", nextReviewAt: "2099-01-01T00:00:00.000Z" }),
      makePhrase({ id: "auto-a", english: "Autonomous untouched", nextReviewAt: "2099-01-01T00:00:00.000Z" }),
    ];
    repo.learningSessions = [
      { id: "daily-active", purpose: "daily", date: "2026-08-16", themeCategoryId: "daily", phraseIds: ["daily-a", "daily-b"], studyIndex: 1, testIndex: 0, phase: "study", startedAt: now, updatedAt: now },
      { id: "auto-active", purpose: "autonomous", date: "2026-08-16", themeCategoryId: "daily", phraseIds: ["auto-a"], studyIndex: 0, testIndex: 0, phase: "study", startedAt: now, updatedAt: now },
    ];

    render(<PhraseBankApp repository={repo as never} />);
    await user.click(await screen.findByRole("button", { name: /继续今日任务/ }));

    expect(await screen.findByText("Daily cursor")).toBeVisible();
    expect(screen.getByText("今日任务 · 新句学习")).toBeVisible();
    expect(screen.queryByText("Autonomous untouched")).not.toBeInTheDocument();
    expect(repo.learningSessions.find(({ id }) => id === "auto-active")).toMatchObject({ studyIndex: 0, phase: "study" });
    expect(repo.learningSessions.find(({ id }) => id === "auto-active")).not.toHaveProperty("completedAt");
  });

  it("preserves an unfinished autonomous checkpoint while Aug 17 review and daily learning complete", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-16T16:05:00.000Z"));
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const repo = new MemoryRepository();
      repo.appPreferences = { dailyMasteryGoal: 10, dailyNewPhraseGoal: 1 };
      repo.phrases = [
        makePhrase({ id: "aug17-due", chinese: "八月十七日复习", nextReviewAt: "2026-08-16T16:00:00.000Z" }),
        makePhrase({ id: "aug17-new", english: "Aug 17 daily phrase", nextReviewAt: "2099-01-01T00:00:00.000Z" }),
        makePhrase({ id: "aug16-auto", english: "Autonomous checkpoint", nextReviewAt: "2099-01-01T00:00:00.000Z" }),
      ];
      repo.learningStates = [
        learnedState("aug17-due"),
        {
          phraseId: "aug16-auto", stage: "learning", firstSeenAt: "2026-08-16T15:00:00.000Z",
          consecutiveGood: 0, masteredDates: [], updatedAt: "2026-08-16T15:00:00.000Z",
        },
      ];
      repo.learningSessions = [{
        id: "aug16-autonomous", purpose: "autonomous", date: "2026-08-16", themeCategoryId: "daily",
        phraseIds: ["aug16-auto"], studyIndex: 0, testIndex: 0, phase: "study",
        startedAt: "2026-08-16T15:00:00.000Z", updatedAt: "2026-08-16T15:00:00.000Z",
      }];

      render(<PhraseBankApp repository={repo as never} />);
      await user.click(await screen.findByRole("button", { name: /继续今日任务/ }));
      expect(await screen.findByText("八月十七日复习")).toBeVisible();
      await user.click(screen.getByRole("button", { name: "查看英文答案并自评" }));
      await user.click(screen.getByRole("button", { name: /掌握/ }));

      expect(await screen.findByText("今日任务 · 新句学习")).toBeVisible();
      expect(screen.getByText("Aug 17 daily phrase")).toBeVisible();
      await user.click(screen.getByRole("button", { name: "我看懂了，下一句" }));
      await user.click(await screen.findByRole("button", { name: "查看答案并自评" }));
      await user.click(screen.getByRole("button", { name: /掌握/ }));

      expect(await screen.findByRole("heading", { name: "今日任务已完成" })).toBeVisible();
      expect(repo.learningSessions.find(({ id }) => id === "aug16-autonomous")).toEqual({
        id: "aug16-autonomous", purpose: "autonomous", date: "2026-08-16", themeCategoryId: "daily",
        phraseIds: ["aug16-auto"], studyIndex: 0, testIndex: 0, phase: "study",
        startedAt: "2026-08-16T15:00:00.000Z", updatedAt: "2026-08-16T15:00:00.000Z",
      });
      expect(repo.learningSessions.find(({ purpose }) => purpose === "daily")).toMatchObject({
        date: "2026-08-17", testIndex: 1, completedAt: expect.any(String),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let an old repository review completion enter the replacement repository's daily queue", async () => {
    const user = userEvent.setup(); const repoA = new MemoryRepository(); const repoB = new MemoryRepository();
    repoA.appPreferences = { dailyMasteryGoal: 10, dailyNewPhraseGoal: 1 };
    repoA.phrases = [
      makePhrase({ id: "due-a", chinese: "仓库 A 到期", origin: "personal" }),
      makePhrase({ id: "new-a", english: "A new", nextReviewAt: "2099-01-01T00:00:00.000Z" }),
    ];
    repoA.learningStates = [learnedState("due-a")];
    repoB.appPreferences = { dailyMasteryGoal: 10, dailyNewPhraseGoal: 1 };
    repoB.phrases = [makePhrase({ id: "new-b", english: "B new must stay queued", nextReviewAt: "2099-01-01T00:00:00.000Z" })];
    let resolveCompletion!: () => void;
    const completeA = vi.fn(() => new Promise<void>((resolve) => { resolveCompletion = resolve; }));
    repoA.completeTrainingSession = completeA;

    const view = render(<PhraseBankApp repository={repoA as never} />);
    await user.click(await screen.findByRole("button", { name: /继续今日任务/ }));
    await user.click(await screen.findByRole("button", { name: "查看英文答案并自评" }));
    await user.click(screen.getByRole("button", { name: /掌握/ }));
    await vi.waitFor(() => expect(completeA).toHaveBeenCalledOnce());

    view.rerender(<PhraseBankApp repository={repoB as never} />);
    expect(await screen.findByRole("button", { name: /继续今日任务/ })).toBeVisible();
    resolveCompletion();
    await Promise.resolve();

    expect(screen.queryByText("今日任务 · 新句学习")).not.toBeInTheDocument();
    expect(repoB.learningSessions).toHaveLength(0);
  });

  it("re-derives the daily goal after a review crosses Shanghai midnight", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-16T15:59:00.000Z"));
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const repo = new MemoryRepository();
      repo.appPreferences = { dailyMasteryGoal: 10, dailyNewPhraseGoal: 1 };
      repo.phrases = [
        makePhrase({ id: "midnight-due", chinese: "跨午夜复习" }),
        makePhrase({ id: "next-day-new", english: "Next Shanghai day", nextReviewAt: "2099-01-01T00:00:00.000Z" }),
      ];
      repo.learningStates = [learnedState("midnight-due")];
      repo.events = [{ id: "old-day-new", sessionId: "old", phraseId: "old-new", source: "new", result: "good", usedPronunciationHint: false, recorded: false, activeSeconds: 0, occurredAt: "2026-08-16T10:00:00.000Z" }];
      render(<PhraseBankApp repository={repo as never} />);
      await user.click(await screen.findByRole("button", { name: /继续今日任务/ }));
      await screen.findByText("跨午夜复习");
      let resolveEvents!: (events: TrainingEvent[]) => void;
      let resolvePhrases!: (phrases: Phrase[]) => void;
      repo.eventReadPromise = new Promise((resolve) => { resolveEvents = resolve; });
      repo.phraseReadPromise = new Promise((resolve) => { resolvePhrases = resolve; });
      await user.click(screen.getByRole("button", { name: "查看英文答案并自评" }));
      await user.click(screen.getByRole("button", { name: /掌握/ }));
      await vi.waitFor(() => expect(repo.phraseReadAttempts).toBeGreaterThanOrEqual(3));

      vi.setSystemTime(new Date("2026-08-16T16:01:00.000Z"));
      resolveEvents([...repo.events]);
      resolvePhrases([...repo.phrases]);

      expect(await screen.findByText("今日任务 · 新句学习")).toBeVisible();
      expect(screen.getByText("Next Shanghai day")).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

  it("continues review when the refreshed Shanghai day has newly due content", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-16T15:59:00.000Z"));
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const repo = new MemoryRepository();
      repo.appPreferences = { dailyMasteryGoal: 10, dailyNewPhraseGoal: 1 };
      repo.phrases = [
        makePhrase({ id: "old-day-due", chinese: "旧日最后一条" }),
        makePhrase({ id: "new-day-due", chinese: "新一天到期复习", nextReviewAt: "2026-08-16T16:00:00.000Z" }),
        makePhrase({ id: "new-day-learning", english: "Must wait until review", nextReviewAt: "2099-01-01T00:00:00.000Z" }),
      ];
      repo.learningStates = [learnedState("old-day-due"), learnedState("new-day-due")];
      repo.listDuePhrases = async (now = new Date()) => repo.phrases.filter((phrase) => new Date(phrase.nextReviewAt).getTime() <= now.getTime());
      const originalComplete = repo.completeTrainingSession.bind(repo);
      let resolveCompletion!: () => void;
      const completeReview = vi.fn((id: string, completedAt: Date) => new Promise<void>((resolve) => {
        resolveCompletion = () => { void originalComplete(id, completedAt).then(resolve); };
      }));
      repo.completeTrainingSession = completeReview;

      render(<PhraseBankApp repository={repo as never} />);
      await user.click(await screen.findByRole("button", { name: /继续今日任务/ }));
      expect(await screen.findByText("旧日最后一条")).toBeVisible();
      await user.click(screen.getByRole("button", { name: "查看英文答案并自评" }));
      await user.click(screen.getByRole("button", { name: /掌握/ }));
      await vi.waitFor(() => expect(completeReview).toHaveBeenCalledOnce());

      vi.setSystemTime(new Date("2026-08-16T16:01:00.000Z"));
      resolveCompletion();

      expect(await screen.findByText("新一天到期复习")).toBeVisible();
      expect(screen.getByText("今日复习 · 中文回忆")).toBeVisible();
      expect(screen.queryByText("今日任务 · 新句学习")).not.toBeInTheDocument();
      await vi.waitFor(() => expect(repo.sessions.filter((session) => !session.completedAt)).toHaveLength(1));
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses refreshed progress instead of the pre-review daily-task snapshot", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository();
    repo.appPreferences = { dailyMasteryGoal: 10, dailyNewPhraseGoal: 1 };
    repo.phrases = [makePhrase({ id: "refresh-due", chinese: "刷新后再决定" })];
    repo.learningStates = [learnedState("refresh-due")];
    render(<PhraseBankApp repository={repo as never} />);
    await user.click(await screen.findByRole("button", { name: /继续今日任务/ }));
    await screen.findByText("刷新后再决定");
    let resolveEvents!: (events: TrainingEvent[]) => void;
    let resolvePhrases!: (phrases: Phrase[]) => void;
    repo.eventReadPromise = new Promise((resolve) => { resolveEvents = resolve; });
    repo.phraseReadPromise = new Promise((resolve) => { resolvePhrases = resolve; });
    await user.click(screen.getByRole("button", { name: "查看英文答案并自评" }));
    await user.click(screen.getByRole("button", { name: /掌握/ }));
    await vi.waitFor(() => expect(repo.phraseReadAttempts).toBeGreaterThanOrEqual(3));

    repo.events.push({ id: "concurrent-new", sessionId: "other", phraseId: "already-learned", source: "new", result: "good", usedPronunciationHint: false, recorded: false, activeSeconds: 0, occurredAt: new Date().toISOString() });
    resolveEvents([...repo.events]);
    resolvePhrases([...repo.phrases]);

    expect(await screen.findByRole("button", { name: /继续今日任务/ })).toBeVisible();
    expect(screen.queryByText("今日任务 · 新句学习")).not.toBeInTheDocument();
  });

  it("keeps the completed review visible when the handoff refresh fails", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository();
    repo.appPreferences = { dailyMasteryGoal: 10, dailyNewPhraseGoal: 1 };
    repo.phrases = [makePhrase({ id: "failed-refresh-due", chinese: "刷新失败复习" })];
    repo.learningStates = [learnedState("failed-refresh-due")];
    render(<PhraseBankApp repository={repo as never} />);
    await user.click(await screen.findByRole("button", { name: /继续今日任务/ }));
    await screen.findByText("刷新失败复习");
    repo.failPhraseReads = true;
    await user.click(screen.getByRole("button", { name: "查看英文答案并自评" }));
    await user.click(screen.getByRole("button", { name: /掌握/ }));

    expect(await screen.findByRole("heading", { name: "这一组完成了" })).toBeVisible();
    expect(screen.queryByText("今日任务 · 新句学习")).not.toBeInTheDocument();
  });

  it("offers the next five autonomous phrases after sixteen prior first-tested records", async () => {
    const repo = new MemoryRepository(); const now = new Date().toISOString();
    repo.phrases = Array.from({ length: 5 }, (_, index) => makePhrase({ id: `next-${index}`, english: `Next phrase ${index}`, origin: "system", kind: "core" }));
    repo.learningStates = Array.from({ length: 16 }, (_, index) => ({ ...learnedState(`done-${index}`), firstTestedAt: now }));
    markDailyTaskComplete(repo);

    render(<PhraseBankApp repository={repo as never} />);

    expect(await screen.findByRole("button", { name: /自主学习/ })).toHaveTextContent("开始学习 5 句");
    expect(screen.getByRole("button", { name: /自主学习/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /继续今日任务/ })).toBeDisabled();
  });

  it("enters new phrase learning without bottom navigation and can return home", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository();
    repo.phrases = [makePhrase({ id: "new", origin: "personal", kind: "standalone" })];
    markDailyTaskComplete(repo);
    render(<PhraseBankApp repository={repo as never} />);
    await user.click(await screen.findByRole("button", { name: /自主学习/ }));
    expect(await screen.findByText("I'll get back to you.")).toBeVisible();
    expect(screen.queryByRole("navigation", { name: "主导航" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /关闭学习并返回首页/ }));
    expect(await screen.findByRole("button", { name: /继续今日任务/ })).toBeDisabled();
  });

  it("refreshes today's learned count after completing a short learning group", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository();
    repo.phrases = [makePhrase({ id: "only-new", origin: "personal", kind: "standalone" })];
    markDailyTaskComplete(repo);
    render(<PhraseBankApp repository={repo as never} />);
    await user.click(await screen.findByRole("button", { name: /自主学习/ }));
    await user.click(await screen.findByRole("button", { name: "我看懂了，下一句" }));
    await user.click(await screen.findByRole("button", { name: "查看答案并自评" }));
    await user.click(await screen.findByRole("button", { name: /掌握/ }));
    await screen.findByRole("heading", { name: "本组学习完成" });
    await user.click(screen.getByRole("button", { name: "返回首页" }));
    expect(await screen.findByText("新学 1 句 · 复习 0 句")).toBeVisible();
    expect(screen.getByRole("button", { name: /自主学习/ })).toBeDisabled();
  });

  it("keeps learning retry and home usable when repository reads keep failing", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository(); repo.phrases.push(makePhrase());
    markDailyTaskComplete(repo);
    render(<PhraseBankApp repository={repo as never} />);
    await screen.findByRole("button", { name: /自主学习/ });
    repo.failPhraseReads = true;
    await user.click(screen.getByRole("button", { name: /自主学习/ }));
    expect(await screen.findByRole("heading", { name: "学习内容暂时打不开" })).toBeVisible();
    const attempts = repo.phraseReadAttempts;
    await user.click(screen.getByRole("button", { name: "重试" }));
    await vi.waitFor(() => expect(repo.phraseReadAttempts).toBeGreaterThan(attempts));
    await user.click(screen.getByRole("button", { name: "返回首页" }));
    expect(await screen.findByRole("button", { name: /自主学习/ })).toBeVisible();
  });

  it("saves a personal phrase as unseen by default or learned when learning is skipped", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository();
    markDailyTaskComplete(repo);
    render(<PhraseBankApp repository={repo as never} />);
    await user.click(await screen.findByRole("button", { name: "添加" }));
    const learnFirst = await screen.findByRole("checkbox", { name: "先在“自主学习”里认识这句话" });
    expect(learnFirst).toBeChecked();
    await user.type(await screen.findByRole("textbox", { name: "英文表达" }), "Newest personal phrase");
    await user.type(screen.getByRole("textbox", { name: "中文含义" }), "新的个人句子");
    await user.click(screen.getByRole("button", { name: "保存语言块" }));
    expect(repo.learningStates).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "复习" }));
    await user.click(screen.getByRole("button", { name: /自主学习/ }));
    expect(await screen.findByText("Newest personal phrase")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /关闭学习并返回首页/ }));
    await user.click(screen.getByRole("button", { name: "添加" }));

    await user.type(await screen.findByRole("textbox", { name: "英文表达" }), "Already familiar phrase");
    await user.type(screen.getByRole("textbox", { name: "中文含义" }), "已经熟悉的句子");
    await user.click(screen.getByRole("checkbox", { name: "先在“自主学习”里认识这句话" }));
    await user.click(screen.getByRole("button", { name: "保存语言块" }));
    expect(repo.learningStates.at(-1)).toMatchObject({ stage: "learned", firstSeenAt: expect.any(String), firstTestedAt: expect.any(String), consecutiveGood: 0, masteredDates: [] });
    expect(repo.events).toHaveLength(10);
  });

  it("shows a clear error and keeps the add form when phrase saving fails", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository(); repo.failPhraseSave = true;
    render(<PhraseBankApp repository={repo as never} />);
    await user.click(await screen.findByRole("button", { name: "添加" }));
    await user.type(await screen.findByRole("textbox", { name: "英文表达" }), "Unsaved phrase");
    await user.type(screen.getByRole("textbox", { name: "中文含义" }), "未保存句子");
    await user.click(screen.getByRole("button", { name: "保存语言块" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("句子保存失败");
    expect(screen.getByRole("heading", { name: "收藏语言块" })).toBeVisible();
  });

  it("atomically blocks duplicate initial saves and allows retry after a failed save settles", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository();
    let rejectSave!: (error: Error) => void;
    repo.savePhraseImpl = () => new Promise<void>((_resolve, reject) => { rejectSave = reject; });
    render(<PhraseBankApp repository={repo as never} />);
    await user.click(await screen.findByRole("button", { name: "添加" }));
    await user.type(await screen.findByRole("textbox", { name: "英文表达" }), "Only once");
    await user.type(screen.getByRole("textbox", { name: "中文含义" }), "只保存一次");
    const form = screen.getByRole("button", { name: "保存语言块" }).closest("form")!;
    fireEvent.submit(form); fireEvent.submit(form);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "英文表达" }), { key: "Enter", code: "Enter" });
    expect(repo.phraseSaveAttempts).toBe(1);
    expect(screen.getByRole("button", { name: "保存语言块" })).toBeDisabled();
    rejectSave(new Error("first failed"));
    expect(await screen.findByRole("alert")).toHaveTextContent("句子保存失败");
    repo.savePhraseImpl = undefined;
    await user.click(screen.getByRole("button", { name: "保存语言块" }));
    await screen.findByRole("heading", { name: "我的句子" });
    expect(repo.phraseSaveAttempts).toBe(2);
    expect(repo.phrases.filter(({ english }) => english === "Only once")).toHaveLength(1);
  });

  it("does not complete or navigate when an initial save from an old repository resolves", async () => {
    const user = userEvent.setup(); const repoA = new MemoryRepository(); const repoB = new MemoryRepository();
    let resolveA!: () => void; let pendingPhrase!: Phrase;
    repoA.savePhraseImpl = (phrase) => new Promise<void>((resolve) => { pendingPhrase = phrase; resolveA = () => { repoA.phrases.push(phrase); resolve(); }; });
    const view = render(<PhraseBankApp repository={repoA as never} />);
    await user.click(await screen.findByRole("button", { name: "添加" }));
    await user.type(await screen.findByRole("textbox", { name: "英文表达" }), "Old pending save");
    await user.type(screen.getByRole("textbox", { name: "中文含义" }), "旧仓库等待保存");
    await user.click(screen.getByRole("button", { name: "保存语言块" }));
    const readsA = repoA.phraseReadAttempts;
    view.rerender(<PhraseBankApp repository={repoB as never} />);
    expect(screen.getByRole("button", { name: "保存语言块" })).toBeEnabled();
    resolveA();
    await vi.waitFor(() => expect(repoA.phrases).toContain(pendingPhrase));
    expect(screen.getByRole("heading", { name: "收藏语言块" })).toBeVisible();
    expect(repoA.phraseReadAttempts).toBe(readsA);
    expect(repoB.phrases).toHaveLength(0);
    expect(screen.queryByText("已收入你的句库")).not.toBeInTheDocument();
  });

  it("invalidates a pending save on unmount without later UI work", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository(); let resolveSave!: () => void; let pending!: Phrase;
    repo.savePhraseImpl = (phrase) => new Promise<void>((resolve) => { pending = phrase; resolveSave = () => { repo.phrases.push(phrase); resolve(); }; });
    const view = render(<PhraseBankApp repository={repo as never} />);
    await user.click(await screen.findByRole("button", { name: "添加" }));
    await user.type(await screen.findByRole("textbox", { name: "英文表达" }), "Unmount pending");
    await user.type(screen.getByRole("textbox", { name: "中文含义" }), "卸载等待保存");
    await user.click(screen.getByRole("button", { name: "保存语言块" }));
    const reads = repo.phraseReadAttempts;
    view.unmount(); resolveSave();
    await vi.waitFor(() => expect(repo.phrases).toContain(pending));
    expect(repo.phraseReadAttempts).toBe(reads);
    expect(screen.queryByText("已收入你的句库")).not.toBeInTheDocument();
  });

  it("retries only the learned-state write after a partial save even when refresh also failed", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository();
    render(<PhraseBankApp repository={repo as never} />);
    await user.click(await screen.findByRole("button", { name: "添加" }));
    await user.type(await screen.findByRole("textbox", { name: "英文表达" }), "Partially saved phrase");
    await user.type(screen.getByRole("textbox", { name: "中文含义" }), "部分保存句子");
    await user.click(screen.getByRole("checkbox", { name: "先在“自主学习”里认识这句话" }));
    repo.failLearningStateSave = true; repo.failPhraseReads = true;
    await user.click(screen.getByRole("button", { name: "保存语言块" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("句子已保存，但设置为已学习失败，目前按未学习处理");
    expect(repo.phraseSaveAttempts).toBe(1);
    repo.failLearningStateSave = false; repo.failPhraseReads = false;
    await user.click(screen.getByRole("button", { name: "只重试学习状态" }));
    await screen.findByRole("heading", { name: "我的句子" });
    expect(repo.phraseSaveAttempts).toBe(1);
    expect(repo.learningStates.at(-1)).toMatchObject({ stage: "learned", firstTestedAt: expect.any(String) });
  });

  it("retries a portable partial-state intent against the current repository after rerender", async () => {
    const user = userEvent.setup(); const repoA = new MemoryRepository(); const repoB = new MemoryRepository(); repoA.failLearningStateSave = true;
    const view = render(<PhraseBankApp repository={repoA as never} />);
    await user.click(await screen.findByRole("button", { name: "添加" }));
    await user.type(await screen.findByRole("textbox", { name: "英文表达" }), "Portable retry");
    await user.type(screen.getByRole("textbox", { name: "中文含义" }), "可迁移重试");
    await user.click(screen.getByRole("checkbox", { name: "先在“自主学习”里认识这句话" }));
    await user.click(screen.getByRole("button", { name: "保存语言块" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("目前按未学习处理");
    repoB.phrases = [{ ...repoA.phrases[0] }];
    view.rerender(<PhraseBankApp repository={repoB as never} />);
    await user.click(screen.getByRole("button", { name: "只重试学习状态" }));
    await screen.findByRole("heading", { name: "我的句子" });
    expect(repoA.learningStates).toHaveLength(0);
    expect(repoA.phraseSaveAttempts).toBe(1);
    expect(repoB.learningStates).toContainEqual(expect.objectContaining({ stage: "learned", firstTestedAt: expect.any(String) }));
    expect(repoB.phraseSaveAttempts).toBe(0);
  });

  it("ignores completion from an old repository's pending partial retry and can retry on the new repository", async () => {
    const user = userEvent.setup(); const repoA = new MemoryRepository(); const repoB = new MemoryRepository(); repoA.failLearningStateSave = true;
    const view = render(<PhraseBankApp repository={repoA as never} />);
    await user.click(await screen.findByRole("button", { name: "添加" }));
    await user.type(await screen.findByRole("textbox", { name: "英文表达" }), "Pending portable retry");
    await user.type(screen.getByRole("textbox", { name: "中文含义" }), "等待迁移重试");
    await user.click(screen.getByRole("checkbox", { name: "先在“自主学习”里认识这句话" }));
    await user.click(screen.getByRole("button", { name: "保存语言块" }));
    await screen.findByRole("button", { name: "只重试学习状态" });
    repoA.failLearningStateSave = false;
    let resolveRetryA!: () => void;
    const originalStateSave = repoA.savePhraseLearningState.bind(repoA);
    repoA.savePhraseLearningState = (state) => new Promise<void>((resolve) => { resolveRetryA = () => { void originalStateSave(state).then(resolve); }; });
    await user.click(screen.getByRole("button", { name: "只重试学习状态" }));
    repoB.phrases = [{ ...repoA.phrases[0] }];
    view.rerender(<PhraseBankApp repository={repoB as never} />);
    resolveRetryA();
    await vi.waitFor(() => expect(repoA.learningStates).toHaveLength(1));
    expect(screen.getByRole("heading", { name: "收藏语言块" })).toBeVisible();
    expect(repoB.learningStates).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "只重试学习状态" }));
    await screen.findByRole("heading", { name: "我的句子" });
    expect(repoB.learningStates).toContainEqual(expect.objectContaining({ phraseId: repoB.phrases[0].id, stage: "learned" }));
  });

  it("filters only system content by all four learning stages and treats missing as unseen", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository();
    repo.phrases = [
      makePhrase({ id: "unseen", english: "Unseen system", origin: "system", kind: "core" }),
      makePhrase({ id: "learning", english: "Learning system", origin: "system", kind: "core" }),
      makePhrase({ id: "learned", english: "Learned system", origin: "system", kind: "core" }),
      makePhrase({ id: "mastered", english: "Mastered system", origin: "system", kind: "core" }),
    ];
    repo.learningStates = [
      { ...learnedState("learning"), stage: "learning" },
      learnedState("learned"),
      { ...learnedState("mastered"), stage: "mastered" },
    ];
    render(<PhraseBankApp repository={repo as never} />);
    await user.click(await screen.findByRole("button", { name: "句库" }));
    await user.click(await screen.findByRole("tab", { name: "系统句库" }));
    for (const label of ["未学习", "学习中", "已学习", "已掌握"]) expect(screen.getByRole("button", { name: label })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "未学习" }));
    expect(screen.getByText("Unseen system")).toBeVisible();
    expect(screen.queryByText("Learning system")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "学习中" }));
    expect(screen.getByText("Learning system")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "已学习" }));
    expect(screen.getByText("Learned system")).toBeVisible();
    expect(screen.queryByText("Mastered system")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "已掌握" }));
    expect(screen.getByText("Mastered system")).toBeVisible();
    await user.type(screen.getByRole("textbox", { name: "搜索语言块" }), "Mastered");
    await user.click(screen.getByRole("button", { name: "日常" }));
    expect(screen.getByText("Mastered system")).toBeVisible();
  });
  it("installs bundled system content during initialization and refreshes safely", async () => {
    const repo = new MemoryRepository();
    const installer = vi.fn(async () => { repo.phrases = [makePhrase({ id: "system-ready", origin: "system", kind: "core" })]; });
    render(<PhraseBankApp repository={repo as never} contentInstaller={installer} />);
    await screen.findByRole("button", { name: /继续今日任务/ });
    expect(installer).toHaveBeenCalledWith(repo);
    expect(repo.phrases).toContainEqual(expect.objectContaining({ id: "system-ready" }));
  });

  it("separates personal and system library tabs and copies system content as personal", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository();
    repo.phrases = [
      makePhrase({ id: "mine", english: "My phrase", origin: "personal", kind: "standalone" }),
      makePhrase({ id: "system", english: "System phrase", origin: "system", kind: "core", subcategory: "planning", cefrLevel: "B1", intent: "coordinate work", contentVersion: "v1", qualityVersion: "q1" }),
    ];
    render(<PhraseBankApp repository={repo as never} />);
    await user.click(await screen.findByRole("button", { name: /句库/ }));
    expect(await screen.findByText("My phrase")).toBeVisible();
    expect(screen.queryByText("System phrase")).not.toBeInTheDocument();
    await user.click(await screen.findByRole("tab", { name: "系统句库" }));
    expect(screen.getByText("System phrase")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "复制到我的句子" }));
    expect(repo.phrases.filter(({ english, origin }) => english === "System phrase" && origin === "personal")).toHaveLength(1);
    expect(repo.phrases.find(({ id }) => id === "system")?.origin).toBe("system");
  });

  it("renders the large system library in bounded pages", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository();
    repo.phrases = Array.from({ length: 60 }, (_, index) => makePhrase({ id: `system-${index}`, english: `System phrase ${index}`, origin: "system", kind: "core", subcategory: "planning", cefrLevel: "B1" }));
    render(<PhraseBankApp repository={repo as never} />);
    await user.click(await screen.findByRole("button", { name: /句库/ }));
    await user.click(await screen.findByRole("tab", { name: "系统句库" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(50);
    await user.click(screen.getByRole("button", { name: "再显示 10 条" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(60);
  });
  it("shows distinct sentence progress instead of accumulated minutes", async () => {
    const repo = new MemoryRepository();
    const now = new Date().toISOString();
    repo.events.push(
      { id: "e1", sessionId: "s1", phraseId: "p1", source: "due", result: "good", usedPronunciationHint: false, recorded: true, activeSeconds: 720, occurredAt: now },
      { id: "e2", sessionId: "s1", phraseId: "p1", source: "due", result: "good", usedPronunciationHint: false, recorded: false, activeSeconds: 1, occurredAt: now },
      { id: "e3", sessionId: "s1", phraseId: "p2", source: "new", result: "hard", usedPronunciationHint: false, recorded: false, activeSeconds: 1, occurredAt: now },
    );
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(now));
    repo.learningStates.push({ phraseId: "p1", stage: "mastered", consecutiveGood: 3, masteredDates: threeMasteryDatesEndingOn(today), updatedAt: now });
    render(<PhraseBankApp repository={repo as never} />);
    expect(await screen.findByText("1 / 10 句")).toBeVisible();
    expect(screen.getByText("三日掌握").parentElement).toHaveTextContent("1 句");
    expect(screen.getByText("新学 0 句 · 复习 1 句")).toBeVisible();
    expect(screen.queryByText(/30 分钟/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /继续今日任务/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /三分钟速练/ })).not.toBeInTheDocument();
  });

  it("shows completed groups and a completed-day headline", async () => {
    const repo = new MemoryRepository();
    const now = new Date().toISOString();
    repo.events.push({ id: "e1", sessionId: "s1", phraseId: "p1", source: "due", result: "good", usedPronunciationHint: false, recorded: true, activeSeconds: 1800, occurredAt: now });
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(now));
    repo.learningStates.push({ phraseId: "p1", stage: "mastered", consecutiveGood: 3, masteredDates: threeMasteryDatesEndingOn(today), updatedAt: now });
    repo.sessions.push({ id: "s1", mode: "quick", startedAt: now, updatedAt: now, completedAt: now, phraseIds: ["p1"], currentIndex: 1, activeSeconds: 1800 });
    render(<PhraseBankApp repository={repo as never} />);
    expect(await screen.findByText("今天有进步")).toBeVisible();
    expect(screen.getByText("1 / 10 句")).toBeVisible();
    expect(screen.getByRole("button", { name: /继续今日任务/ })).toBeVisible();
  });

  it("starts daily review with Chinese before English", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository();
    repo.phrases.push(makePhrase({ chinese: "我还没决定。", english: "I haven't decided yet." }));
    repo.learningStates = repo.phrases.map(({ id }) => learnedState(id));
    render(<PhraseBankApp repository={repo as never} />);
    await user.click(await screen.findByRole("button", { name: /继续今日任务/ }));
    expect(await screen.findByText("我还没决定。")).toBeVisible();
    expect(screen.queryByText("I haven't decided yet.")).not.toBeInTheDocument();
    expect(screen.getByText(/第\s*1\s*\/\s*1\s*个/)).toBeVisible();
    expect(repo.sessions[0]).toMatchObject({ mode: "standard", currentIndex: 0 });
  });

  it("continues an active review session at its saved phrase", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository();
    const now = new Date().toISOString();
    repo.phrases = Array.from({ length: 3 }, (_, index) => makePhrase({ id: `p${index}`, chinese: `中文 ${index}` }));
    repo.learningStates = repo.phrases.map(({ id }) => learnedState(id));
    repo.sessions = [{ id: "active-review", mode: "standard", startedAt: now, updatedAt: now, phraseIds: ["p0", "p1", "p2"], sources: ["due", "due", "due"], currentIndex: 1, activeSeconds: 3 }];
    render(<PhraseBankApp repository={repo as never} />);
    const continueButton = await screen.findByRole("button", { name: /继续今日任务/ });
    expect(continueButton).toHaveTextContent("继续复习 · 剩余 2 句");
    await user.click(continueButton);
    expect(await screen.findByText("中文 1")).toBeVisible();
    expect(screen.queryByText("中文 0")).not.toBeInTheDocument();
  });

  it("turns weak phrase ids into readable weekly focus phrases", async () => {
    const repo = new MemoryRepository(); const now = new Date().toISOString();
    repo.phrases.push(makePhrase({ id: "weak-readable", english: "Could you clarify that?", chinese: "你能说明一下吗？" }));
    repo.events.push({ id: "weak-event", sessionId: "old", phraseId: "weak-readable", source: "weak", result: "again", usedPronunciationHint: false, recorded: false, activeSeconds: 20, occurredAt: now });
    render(<PhraseBankApp repository={repo as never} />);
    expect(await screen.findByText("Could you clarify that?")).toBeVisible();
    expect(screen.getByText("你能说明一下吗？")).toBeVisible();
    expect(screen.getByText("日常")).toBeVisible();
    expect(screen.getByText("从模糊到掌握")).toBeVisible();
    expect(screen.getByText("本周复习保持率")).toBeVisible();
    expect(screen.getByText("容易忘记")).toBeVisible();
    expect(screen.queryByText("有效分钟")).not.toBeInTheDocument();
  });

  it("retries and returns home even when repository refresh keeps failing", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository(); repo.phrases.push(makePhrase());
    repo.learningStates.push(learnedState("p1"));
    render(<PhraseBankApp repository={repo as never} />);
    await screen.findByText("今天，说出来");
    repo.failPhraseReads = true;
    await user.click(screen.getByRole("button", { name: /继续今日任务/ }));
    expect(await screen.findByRole("heading", { name: "训练暂时打不开" })).toBeVisible();
    const attemptsBeforeRetry = repo.phraseReadAttempts;
    await user.click(screen.getByRole("button", { name: "重试" }));
    await vi.waitFor(() => expect(repo.phraseReadAttempts).toBeGreaterThan(attemptsBeforeRetry));
    expect(await screen.findByRole("heading", { name: "训练暂时打不开" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "返回首页" }));
    expect(await screen.findByText("今天，说出来")).toBeVisible();
  });

  it("keeps the library, add and settings navigation", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository(); repo.phrases.push(makePhrase());
    render(<PhraseBankApp repository={repo as never} />);
    await screen.findByText("今天，说出来");
    await user.click(screen.getByRole("button", { name: "句库" }));
    expect(await screen.findByRole("heading", { name: "我的句子" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "添加" }));
    expect(await screen.findByRole("heading", { name: "收藏语言块" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "设置" }));
    expect(await screen.findByRole("heading", { name: "设置" })).toBeVisible();
  });

  it("loads speech preferences and persists auto reading and accent changes", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository();
    repo.preferences = { accent: "en-GB", autoSpeak: true };
    let resolveLoad!: (value: SpeechPreferences) => void;
    repo.preferenceLoad = new Promise((resolve) => { resolveLoad = resolve; });
    render(<PhraseBankApp repository={repo as never} />);
    await user.click(await screen.findByRole("button", { name: "设置" }));

    const autoSpeak = await screen.findByRole("checkbox", { name: "自动朗读答案" });
    resolveLoad(repo.preferences);
    await vi.waitFor(() => expect(autoSpeak).toBeEnabled());
    expect(autoSpeak).toBeChecked();
    expect(screen.getByRole("radio", { name: "英式英语" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "美式英语" })).not.toBeChecked();

    await user.click(autoSpeak);
    await vi.waitFor(() => expect(repo.preferenceSaves.at(-1)).toEqual({ accent: "en-GB", autoSpeak: false }));
    await user.click(screen.getByRole("radio", { name: "美式英语" }));
    await vi.waitFor(() => expect(repo.preferenceSaves.at(-1)).toEqual({ accent: "en-US", autoSpeak: false }));
  });

  it("saves mastery and new-phrase goals together and refreshes once", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository();
    const refreshSpy = vi.spyOn(repo, "listPhrases");
    render(<PhraseBankApp repository={repo as never} />);
    expect(await screen.findByText("0 / 10 句")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "设置" }));
    const masteryInput = await screen.findByRole("spinbutton", { name: "每日答对目标" });
    const newPhraseInput = screen.getByRole("spinbutton", { name: "每日新句目标" });
    expect(masteryInput).toHaveValue(10);
    expect(newPhraseInput).toHaveValue(10);
    await user.clear(masteryInput); await user.type(masteryInput, "18");
    await user.clear(newPhraseInput); await user.type(newPhraseInput, "15");
    const readsBeforeSave = refreshSpy.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "保存每日目标" }));
    await vi.waitFor(() => expect(repo.appPreferenceSaves).toEqual([{ dailyMasteryGoal: 18, dailyNewPhraseGoal: 15 }]));
    expect(refreshSpy.mock.calls.length - readsBeforeSave).toBe(1);
    await user.click(screen.getByRole("button", { name: "复习" }));
    expect(await screen.findByText("0 / 18 句")).toBeVisible();
    expect(screen.getByRole("button", { name: /继续今日任务/ })).toHaveTextContent("今日新句 0 / 15 · 还差 15 句");
    expect(screen.getByRole("button", { name: /自主学习/ })).toBeDisabled();
  });

  it("excludes an active daily queue from the autonomous home preview", async () => {
    const repo = new MemoryRepository();
    const reservedIds = Array.from({ length: 4 }, (_, index) => `daily-reserved-${index}`);
    repo.phrases = [
      ...reservedIds.map((id) => makePhrase({ id })),
      makePhrase({ id: "autonomous-available-1" }),
      makePhrase({ id: "autonomous-available-2" }),
    ];
    repo.learningSessions = [activeLearningSession("daily", reservedIds)];
    markDailyTaskComplete(repo);

    render(<PhraseBankApp repository={repo as never} />);

    expect(await screen.findByRole("button", { name: /自主学习/ })).toHaveTextContent("开始学习 2 句");
  });

  it("excludes an active autonomous queue from the daily home preview", async () => {
    const repo = new MemoryRepository();
    const reservedIds = Array.from({ length: 4 }, (_, index) => `autonomous-reserved-${index}`);
    repo.phrases = [
      ...reservedIds.map((id) => makePhrase({ id })),
      makePhrase({ id: "daily-available-1" }),
      makePhrase({ id: "daily-available-2" }),
    ];
    repo.learningSessions = [activeLearningSession("autonomous", reservedIds)];

    render(<PhraseBankApp repository={repo as never} />);

    expect(await screen.findByRole("button", { name: /继续今日任务/ })).toHaveTextContent("还差 8 句");
  });

  it.each(["0", "51", "1.5"])('rejects invalid new-phrase goal %j without refreshing', async (value) => {
    const user = userEvent.setup(); const repo = new MemoryRepository();
    const refreshSpy = vi.spyOn(repo, "listPhrases");
    render(<PhraseBankApp repository={repo as never} />);
    await user.click(await screen.findByRole("button", { name: "设置" }));
    const input = await screen.findByRole("spinbutton", { name: "每日新句目标" });
    await user.clear(input); await user.type(input, value);
    const readsBeforeSave = refreshSpy.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "保存每日目标" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("每日新句目标必须是 1 到 50 的整数");
    expect(repo.appPreferenceSaves).toEqual([]);
    expect(refreshSpy.mock.calls.length).toBe(readsBeforeSave);
  });

  it.each(["", "0", "-2", "1.5", "abc"])("rejects invalid mastery goal %j", async (value) => {
    const user = userEvent.setup(); const repo = new MemoryRepository();
    render(<PhraseBankApp repository={repo as never} />);
    await user.click(await screen.findByRole("button", { name: "设置" }));
    const input = await screen.findByRole("spinbutton", { name: "每日答对目标" });
    await user.clear(input); if (value) await user.type(input, value);
    await user.click(screen.getByRole("button", { name: "保存每日目标" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("每日答对目标必须是正整数");
    expect(repo.appPreferenceSaves).toEqual([]);
  });

  it("keeps both edited goals after a failed save and refreshes once after retry", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository(); repo.failAppPreferenceSave = true;
    const refreshSpy = vi.spyOn(repo, "listPhrases");
    render(<PhraseBankApp repository={repo as never} />);
    await user.click(await screen.findByRole("button", { name: "设置" }));
    const masteryInput = await screen.findByRole("spinbutton", { name: "每日答对目标" });
    const newPhraseInput = screen.getByRole("spinbutton", { name: "每日新句目标" });
    await user.clear(masteryInput); await user.type(masteryInput, "18");
    await user.clear(newPhraseInput); await user.type(newPhraseInput, "15");
    const readsBeforeSave = refreshSpy.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "保存每日目标" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("每日目标保存失败，请重试");
    expect(masteryInput).toHaveValue(18);
    expect(newPhraseInput).toHaveValue(15);
    expect(refreshSpy.mock.calls.length).toBe(readsBeforeSave);
    repo.failAppPreferenceSave = false;
    await user.click(screen.getByRole("button", { name: "保存每日目标" }));
    await vi.waitFor(() => expect(repo.appPreferences).toEqual({ dailyMasteryGoal: 18, dailyNewPhraseGoal: 15 }));
    expect(refreshSpy.mock.calls.length - readsBeforeSave).toBe(1);
    await user.click(screen.getByRole("button", { name: "复习" }));
    expect(await screen.findByRole("button", { name: /继续今日任务/ })).toHaveTextContent("今日新句 0 / 15 · 还差 15 句");
    expect(screen.getByRole("button", { name: /自主学习/ })).toBeDisabled();
  });

  it("keeps settings usable when speech preferences cannot be loaded or saved", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository();
    repo.failPreferenceLoad = true;
    render(<PhraseBankApp repository={repo as never} />);
    await user.click(await screen.findByRole("button", { name: "设置" }));

    expect(await screen.findByRole("checkbox", { name: "自动朗读答案" })).toBeChecked();
    expect(await screen.findByRole("alert")).toHaveTextContent("语音偏好暂时无法读取");
    repo.failPreferenceLoad = false;
    repo.failPreferenceSave = true;
    await user.click(screen.getByRole("checkbox", { name: "自动朗读答案" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("语音偏好暂时无法保存");
    expect(screen.getByRole("checkbox", { name: "自动朗读答案" })).toBeChecked();
    expect(screen.getByRole("heading", { name: "设置" })).toBeVisible();
  });

  it("waits for delayed preference loading before allowing changes", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository();
    let resolveLoad!: (value: SpeechPreferences) => void;
    repo.preferenceLoad = new Promise((resolve) => { resolveLoad = resolve; });
    render(<PhraseBankApp repository={repo as never} />);
    await user.click(await screen.findByRole("button", { name: "设置" }));

    const autoSpeak = await screen.findByRole("checkbox", { name: "自动朗读答案" });
    expect(autoSpeak).toBeDisabled();
    expect(screen.getByRole("radio", { name: "英式英语" })).toBeDisabled();
    resolveLoad({ accent: "en-GB", autoSpeak: false });
    await vi.waitFor(() => expect(autoSpeak).toBeEnabled());
    expect(autoSpeak).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "英式英语" })).toBeChecked();
    await user.click(autoSpeak);
    expect(repo.preferenceSaves.at(-1)).toEqual({ accent: "en-GB", autoSpeak: true });
  });

  it("serializes preference writes and rolls a failed latest change back to the last stored value", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository();
    repo.preferences = { accent: "en-US", autoSpeak: true };
    const pending: Array<{ value: SpeechPreferences; resolve: () => void; reject: (error: Error) => void }> = [];
    repo.savePreferenceImpl = (value) => new Promise<void>((resolve, reject) => {
      pending.push({ value, resolve: () => { repo.preferences = value; resolve(); }, reject });
    });
    render(<PhraseBankApp repository={repo as never} />);
    await user.click(await screen.findByRole("button", { name: "设置" }));
    const autoSpeak = await screen.findByRole("checkbox", { name: "自动朗读答案" });
    await vi.waitFor(() => expect(autoSpeak).toBeEnabled());

    await user.click(autoSpeak);
    await user.click(screen.getByRole("radio", { name: "英式英语" }));
    expect(pending).toHaveLength(1);
    expect(autoSpeak).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "英式英语" })).toBeChecked();

    pending[0].resolve();
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[1].value).toEqual({ accent: "en-GB", autoSpeak: false });
    pending[1].reject(new Error("latest save failed"));

    expect(await screen.findByRole("alert")).toHaveTextContent("已恢复上次设置");
    expect(autoSpeak).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "美式英语" })).toBeChecked();
    expect(repo.preferences).toEqual({ accent: "en-US", autoSpeak: false });
  });

  it("does not request microphone permission from speech settings", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository();
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    render(<PhraseBankApp repository={repo as never} />);
    await user.click(await screen.findByRole("button", { name: "设置" }));
    await screen.findByText("语音训练");
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
