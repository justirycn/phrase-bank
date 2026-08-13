import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PhraseBankApp } from "../../app/PhraseBankApp";
import type { AppPreferences, BackupEnvelopeV5, Category, Phrase, PhraseLearningState, ReviewResult, SpeechPreferences, TrainingEvent, TrainingSessionRecord } from "../../app/domain/types";

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
  phraseReadAttempts = 0;
  categories: Category[] = [{ id: "daily", name: "日常", isDefault: true, createdAt: "2026-08-07T00:00:00.000Z", updatedAt: "2026-08-07T00:00:00.000Z" }];
  async initialize() { this.initializeAttempts += 1; if (this.initializePromise) await this.initializePromise; if (this.failInitialize) throw new Error("initialize failed"); }
  async listPhrases() { this.phraseReadAttempts += 1; if (this.failPhraseReads) throw new Error("db failed"); return [...this.phrases]; }
  async listCategories() { return [...this.categories]; }
  async listDuePhrases() { return [...this.phrases]; }
  async savePhrase(phrase: Phrase) { this.phraseSaveAttempts += 1; if (this.savePhraseImpl) return this.savePhraseImpl(phrase); if (this.failPhraseSave) throw new Error("save failed"); this.phrases = [...this.phrases.filter((p) => p.id !== phrase.id), phrase]; }
  async deletePhrase(id: string) { this.phrases = this.phrases.filter((p) => p.id !== id); }
  async submitReview(id: string, result: ReviewResult) { void id; void result; }
  events: TrainingEvent[] = [];
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
  appPreferences: AppPreferences = { dailyMasteryGoal: 10 };
  appPreferenceSaves: AppPreferences[] = [];
  failAppPreferenceSave = false;
  async getPhrase(id: string) { return this.phrases.find((phrase) => phrase.id === id); }
  async submitTrainingReview(event: TrainingEvent) { this.events.push(event); }
  async saveTrainingEvent(event: TrainingEvent) { this.events = [...this.events.filter((item) => item.id !== event.id), event]; }
  async listTrainingEvents() { if (this.failTrainingEventReads) throw new Error("event read failed"); return [...this.events]; }
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
  async getActiveLearningSession() { return this.learningSessions.find((session) => !session.completedAt); }
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

describe("PhraseBankApp", () => {
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
    expect(screen.getByRole("button", { name: /学习新句/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /到期复习/ })).toBeEnabled();
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
    const review = await screen.findByRole("button", { name: /到期复习/ });
    expect(review).toHaveTextContent("2 句到期");
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
    expect(await screen.findByRole("heading", { name: "这一组完成了" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "回到首页" }));
    expect(await screen.findByRole("button", { name: /到期复习/ })).toHaveTextContent("2 句到期");
  });
  it("shows continue, new learning, and resumable review entries without quick practice", async () => {
    const repo = new MemoryRepository();
    repo.phrases = [
      makePhrase({ id: "new", origin: "system", kind: "core" }),
      makePhrase({ id: "learned", origin: "personal", kind: "standalone" }),
    ];
    repo.learningStates = [learnedState("learned")];
    render(<PhraseBankApp repository={repo as never} />);
    expect(await screen.findByRole("button", { name: /学习新句/ })).toHaveTextContent("0 / 15");
    expect(screen.getByRole("button", { name: /到期复习/ })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: /继续今日任务/ })).toBeVisible();
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
    render(<PhraseBankApp repository={repo as never} />);
    const entry = await screen.findByRole("button", { name: /学习新句/ });
    expect(entry).toHaveTextContent("下一组 4 句 · 工作");
    await user.click(entry);
    await vi.waitFor(() => expect(repo.learningSessions[0]).toMatchObject({ themeCategoryId: "work", phraseIds: expect.any(Array) }));
    expect(repo.learningSessions[0].phraseIds).toHaveLength(4);
    vi.useRealTimers();
  });

  it("shows and restores an active group even when today's limit is reached", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository(); const now = new Date().toISOString();
    repo.phrases = [makePhrase({ id: "active-a" }), makePhrase({ id: "active-b" })];
    repo.learningStates = Array.from({ length: 15 }, (_, index) => ({ ...learnedState(`done-${index}`), firstTestedAt: now }));
    repo.learningSessions = [{ id: "active", date: "2026-08-10", themeCategoryId: "daily", phraseIds: ["active-a", "active-b"], studyIndex: 0, testIndex: 0, phase: "study", startedAt: now, updatedAt: now }];
    render(<PhraseBankApp repository={repo as never} />);
    const entry = await screen.findByRole("button", { name: /学习新句/ });
    expect(entry).toHaveTextContent("恢复本组：剩余 2 / 共 2 句 · 日常");
    await user.click(entry);
    expect(await screen.findByText("I'll get back to you.")).toBeVisible();
  });

  it("enters new phrase learning without bottom navigation and can return home", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository();
    repo.phrases = [makePhrase({ id: "new", origin: "personal", kind: "standalone" })];
    render(<PhraseBankApp repository={repo as never} />);
    await user.click(await screen.findByRole("button", { name: /学习新句/ }));
    expect(await screen.findByText("I'll get back to you.")).toBeVisible();
    expect(screen.queryByRole("navigation", { name: "主导航" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /关闭学习并返回首页/ }));
    expect(await screen.findByRole("button", { name: /到期复习/ })).toBeVisible();
  });

  it("refreshes today's learned count after completing a short learning group", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository();
    repo.phrases = [makePhrase({ id: "only-new", origin: "personal", kind: "standalone" })];
    render(<PhraseBankApp repository={repo as never} />);
    await user.click(await screen.findByRole("button", { name: /学习新句/ }));
    await user.click(await screen.findByRole("button", { name: "我看懂了，下一句" }));
    await user.click(await screen.findByRole("button", { name: "查看答案并自评" }));
    await user.click(await screen.findByRole("button", { name: /掌握/ }));
    await screen.findByRole("heading", { name: "本组学习完成" });
    await user.click(screen.getByRole("button", { name: "返回首页" }));
    expect(await screen.findByRole("button", { name: /学习新句.*今天已学 1 \/ 15/ })).toBeVisible();
  });

  it("keeps learning retry and home usable when repository reads keep failing", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository(); repo.phrases.push(makePhrase());
    render(<PhraseBankApp repository={repo as never} />);
    await screen.findByRole("button", { name: /学习新句/ });
    repo.failPhraseReads = true;
    await user.click(screen.getByRole("button", { name: /学习新句/ }));
    expect(await screen.findByRole("heading", { name: "学习内容暂时打不开" })).toBeVisible();
    const attempts = repo.phraseReadAttempts;
    await user.click(screen.getByRole("button", { name: "重试" }));
    await vi.waitFor(() => expect(repo.phraseReadAttempts).toBeGreaterThan(attempts));
    await user.click(screen.getByRole("button", { name: "返回首页" }));
    expect(await screen.findByRole("button", { name: /学习新句/ })).toBeVisible();
  });

  it("saves a personal phrase as unseen by default or learned when learning is skipped", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository();
    render(<PhraseBankApp repository={repo as never} />);
    await user.click(await screen.findByRole("button", { name: "添加" }));
    const learnFirst = await screen.findByRole("checkbox", { name: /先在.*学习新句.*认识/ });
    expect(learnFirst).toBeChecked();
    await user.type(await screen.findByRole("textbox", { name: "英文表达" }), "Newest personal phrase");
    await user.type(screen.getByRole("textbox", { name: "中文含义" }), "新的个人句子");
    await user.click(screen.getByRole("button", { name: "保存语言块" }));
    expect(repo.learningStates).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "复习" }));
    await user.click(screen.getByRole("button", { name: /学习新句/ }));
    expect(await screen.findByText("Newest personal phrase")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /关闭学习并返回首页/ }));
    await user.click(screen.getByRole("button", { name: "添加" }));

    await user.type(await screen.findByRole("textbox", { name: "英文表达" }), "Already familiar phrase");
    await user.type(screen.getByRole("textbox", { name: "中文含义" }), "已经熟悉的句子");
    await user.click(screen.getByRole("checkbox", { name: /先在.*学习新句.*认识/ }));
    await user.click(screen.getByRole("button", { name: "保存语言块" }));
    expect(repo.learningStates.at(-1)).toMatchObject({ stage: "learned", firstSeenAt: expect.any(String), firstTestedAt: expect.any(String), consecutiveGood: 0, masteredDates: [] });
    expect(repo.events).toHaveLength(0);
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
    await user.click(screen.getByRole("checkbox", { name: /先在.*学习新句.*认识/ }));
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
    await user.click(screen.getByRole("checkbox", { name: /先在.*学习新句.*认识/ }));
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
    await user.click(screen.getByRole("checkbox", { name: /先在.*学习新句.*认识/ }));
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
    render(<PhraseBankApp repository={repo as never} />);
    expect(await screen.findByText("1 / 10 句")).toBeVisible();
    expect(screen.getByText("新学 0 句 · 复习 1 句")).toBeVisible();
    expect(screen.queryByText(/30 分钟/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /到期复习/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /三分钟速练/ })).not.toBeInTheDocument();
  });

  it("shows completed groups and a completed-day headline", async () => {
    const repo = new MemoryRepository();
    const now = new Date().toISOString();
    repo.events.push({ id: "e1", sessionId: "s1", phraseId: "p1", source: "due", result: "good", usedPronunciationHint: false, recorded: true, activeSeconds: 1800, occurredAt: now });
    repo.sessions.push({ id: "s1", mode: "quick", startedAt: now, updatedAt: now, completedAt: now, phraseIds: ["p1"], currentIndex: 1, activeSeconds: 1800 });
    render(<PhraseBankApp repository={repo as never} />);
    expect(await screen.findByText("今天有进步")).toBeVisible();
    expect(screen.getByText("1 / 10 句")).toBeVisible();
    expect(screen.getByRole("button", { name: /到期复习/ })).toBeVisible();
  });

  it("starts daily review with Chinese before English", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository();
    repo.phrases.push(makePhrase({ chinese: "我还没决定。", english: "I haven't decided yet." }));
    repo.learningStates = repo.phrases.map(({ id }) => learnedState(id));
    render(<PhraseBankApp repository={repo as never} />);
    await user.click(await screen.findByRole("button", { name: /到期复习/ }));
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
    expect(continueButton).toHaveTextContent("继续未完成的到期复习 · 剩余 2 句");
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
  });

  it("retries and returns home even when repository refresh keeps failing", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository(); repo.phrases.push(makePhrase());
    render(<PhraseBankApp repository={repo as never} />);
    await screen.findByText("今天，说出来");
    repo.failPhraseReads = true;
    await user.click(screen.getByRole("button", { name: /到期复习/ }));
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

  it("saves a positive integer mastery goal and refreshes the home target", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository();
    render(<PhraseBankApp repository={repo as never} />);
    expect(await screen.findByText("0 / 10 句")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "设置" }));
    const input = await screen.findByRole("spinbutton", { name: "每日掌握目标" });
    expect(input).toHaveValue(10);
    await user.clear(input); await user.type(input, "18");
    await user.click(screen.getByRole("button", { name: "保存每日目标" }));
    await vi.waitFor(() => expect(repo.appPreferenceSaves).toEqual([{ dailyMasteryGoal: 18 }]));
    await user.click(screen.getByRole("button", { name: "复习" }));
    expect(await screen.findByText("0 / 18 句")).toBeVisible();
  });

  it.each(["", "0", "-2", "1.5", "abc"])("rejects invalid mastery goal %j", async (value) => {
    const user = userEvent.setup(); const repo = new MemoryRepository();
    render(<PhraseBankApp repository={repo as never} />);
    await user.click(await screen.findByRole("button", { name: "设置" }));
    const input = await screen.findByRole("spinbutton", { name: "每日掌握目标" });
    await user.clear(input); if (value) await user.type(input, value);
    await user.click(screen.getByRole("button", { name: "保存每日目标" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("每日掌握目标必须是正整数");
    expect(repo.appPreferenceSaves).toEqual([]);
  });

  it("keeps the stored mastery goal when saving fails", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository(); repo.failAppPreferenceSave = true;
    render(<PhraseBankApp repository={repo as never} />);
    await user.click(await screen.findByRole("button", { name: "设置" }));
    const input = await screen.findByRole("spinbutton", { name: "每日掌握目标" });
    await user.clear(input); await user.type(input, "20");
    await user.click(screen.getByRole("button", { name: "保存每日目标" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("每日掌握目标保存失败");
    expect(input).toHaveValue(10);
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
