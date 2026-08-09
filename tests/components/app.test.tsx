import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PhraseBankApp } from "../../app/PhraseBankApp";
import type { BackupEnvelopeV2, Category, Phrase, ReviewResult, SpeechPreferences, TrainingEvent, TrainingSessionRecord } from "../../app/domain/types";

class MemoryRepository {
  phrases: Phrase[] = [];
  failPhraseReads = false;
  phraseReadAttempts = 0;
  categories: Category[] = [{ id: "daily", name: "日常", isDefault: true, createdAt: "2026-08-07T00:00:00.000Z", updatedAt: "2026-08-07T00:00:00.000Z" }];
  async initialize() {}
  async listPhrases() { this.phraseReadAttempts += 1; if (this.failPhraseReads) throw new Error("db failed"); return [...this.phrases]; }
  async listCategories() { return [...this.categories]; }
  async listDuePhrases() { return [...this.phrases]; }
  async savePhrase(phrase: Phrase) { this.phrases = [...this.phrases.filter((p) => p.id !== phrase.id), phrase]; }
  async deletePhrase(id: string) { this.phrases = this.phrases.filter((p) => p.id !== id); }
  async submitReview(id: string, result: ReviewResult) { void id; void result; }
  events: TrainingEvent[] = [];
  sessions: TrainingSessionRecord[] = [];
  preferences: SpeechPreferences = { accent: "en-US", autoSpeak: false };
  failPreferenceLoad = false;
  failPreferenceSave = false;
  preferenceSaves: SpeechPreferences[] = [];
  preferenceLoad?: Promise<SpeechPreferences>;
  savePreferenceImpl?: (value: SpeechPreferences) => Promise<void>;
  async getPhrase(id: string) { return this.phrases.find((phrase) => phrase.id === id); }
  async submitTrainingReview(event: TrainingEvent) { this.events.push(event); }
  async saveTrainingEvent(event: TrainingEvent) { this.events = [...this.events.filter((item) => item.id !== event.id), event]; }
  async listTrainingEvents() { return [...this.events]; }
  async saveTrainingSession(session: TrainingSessionRecord) { this.sessions = [...this.sessions.filter((item) => item.id !== session.id), session]; }
  async getActiveTrainingSession() { return this.sessions.find((session) => !session.completedAt); }
  async completeTrainingSession(id: string, completedAt: Date) { this.sessions = this.sessions.map((session) => session.id === id ? { ...session, completedAt: completedAt.toISOString() } : session); }
  async getSpeechPreferences() { if (this.preferenceLoad) return this.preferenceLoad; if (this.failPreferenceLoad) throw new Error("preference load failed"); return this.preferences; }
  async saveSpeechPreferences(value: SpeechPreferences) { this.preferenceSaves.push(value); if (this.savePreferenceImpl) return this.savePreferenceImpl(value); if (this.failPreferenceSave) throw new Error("preference save failed"); this.preferences = value; }
  async saveCategory(category: Category) { this.categories.push(category); }
  async deleteCategoryAndMigrate() {}
  async exportSnapshot(): Promise<BackupEnvelopeV2> { return { format: "personal-phrase-bank", version: 2, exportedAt: new Date().toISOString(), categories: this.categories, phrases: this.phrases, reviewLogs: [], trainingEvents: this.events, trainingSessions: this.sessions }; }
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

describe("PhraseBankApp", () => {
  it("shows accumulated daily progress and both training entries", async () => {
    const repo = new MemoryRepository();
    repo.events.push({ id: "e1", sessionId: "s1", phraseId: "p1", source: "due", result: "hard", usedPronunciationHint: false, recorded: true, activeSeconds: 720, occurredAt: new Date().toISOString() });
    render(<PhraseBankApp repository={repo as never} />);
    expect(await screen.findByText("12 / 30 分钟")).toBeVisible();
    expect(screen.getByRole("button", { name: /开始 10 分钟训练/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /快速练一组/ })).toBeVisible();
  });

  it("shows completed groups and a completed-day headline", async () => {
    const repo = new MemoryRepository();
    const now = new Date().toISOString();
    repo.events.push({ id: "e1", sessionId: "s1", phraseId: "p1", source: "due", result: "good", usedPronunciationHint: false, recorded: true, activeSeconds: 1800, occurredAt: now });
    repo.sessions.push({ id: "s1", mode: "quick", startedAt: now, updatedAt: now, completedAt: now, phraseIds: ["p1"], currentIndex: 1, activeSeconds: 1800 });
    render(<PhraseBankApp repository={repo as never} />);
    expect(await screen.findByText("今天已经完成")).toBeVisible();
    expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent?.includes("完成 1 组") === true)).toBeVisible();
    expect(screen.getByRole("button", { name: /再练一组/ })).toBeVisible();
  });

  it("starts standard practice with Chinese before English", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository();
    repo.phrases.push(makePhrase({ chinese: "我还没决定。", english: "I haven't decided yet." }));
    render(<PhraseBankApp repository={repo as never} />);
    await user.click(await screen.findByRole("button", { name: /开始 10 分钟训练/ }));
    expect(await screen.findByText("我还没决定。")).toBeVisible();
    expect(screen.queryByText("I haven't decided yet.")).not.toBeInTheDocument();
    expect(repo.sessions[0]?.mode).toBe("standard");
  });

  it("starts a three-item quick group", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository();
    repo.phrases = Array.from({ length: 4 }, (_, index) => makePhrase({ id: `p${index}`, chinese: `中文 ${index}` }));
    render(<PhraseBankApp repository={repo as never} />);
    await user.click(await screen.findByRole("button", { name: /快速练一组/ }));
    expect(await screen.findByText(/中文/)).toBeVisible();
    expect(repo.sessions[0]).toMatchObject({ mode: "quick", phraseIds: expect.any(Array) });
    expect(repo.sessions[0]?.phraseIds).toHaveLength(3);
  });

  it("does not introduce more new phrases after three distinct new items today", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository(); const now = new Date().toISOString();
    repo.phrases = Array.from({ length: 4 }, (_, index) => makePhrase({ id: `new-${index}`, chinese: `新句 ${index}`, lastReviewedAt: undefined }));
    repo.events = Array.from({ length: 3 }, (_, index) => ({ id: `event-${index}`, sessionId: "old", phraseId: `seen-${index}`, source: "new" as const, result: "hard" as const, usedPronunciationHint: false, recorded: false, activeSeconds: 1, occurredAt: now }));
    render(<PhraseBankApp repository={repo as never} />);
    await user.click(await screen.findByRole("button", { name: /快速练一组/ }));
    await screen.findByText("这一组完成了");
    expect(repo.sessions[0]?.phraseIds).toHaveLength(0);
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
    await user.click(screen.getByRole("button", { name: /快速练一组/ }));
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
    expect(await screen.findByRole("heading", { name: "我的句库" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "添加" }));
    expect(await screen.findByRole("heading", { name: "收藏语言块" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "设置" }));
    expect(await screen.findByRole("heading", { name: "设置" })).toBeVisible();
  });

  it("loads speech preferences and persists auto reading and accent changes", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository();
    repo.preferences = { accent: "en-GB", autoSpeak: true };
    render(<PhraseBankApp repository={repo as never} />);
    await user.click(await screen.findByRole("button", { name: "设置" }));

    const autoSpeak = await screen.findByRole("checkbox", { name: "自动朗读答案" });
    expect(autoSpeak).toBeChecked();
    expect(screen.getByRole("radio", { name: "英式英语" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "美式英语" })).not.toBeChecked();

    await user.click(autoSpeak);
    await vi.waitFor(() => expect(repo.preferenceSaves.at(-1)).toEqual({ accent: "en-GB", autoSpeak: false }));
    await user.click(screen.getByRole("radio", { name: "美式英语" }));
    await vi.waitFor(() => expect(repo.preferenceSaves.at(-1)).toEqual({ accent: "en-US", autoSpeak: false }));
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

  it("does not let an older failed save roll back a newer successful preference", async () => {
    const user = userEvent.setup(); const repo = new MemoryRepository();
    repo.preferences = { accent: "en-US", autoSpeak: true };
    let rejectFirst!: (error: Error) => void;
    let resolveSecond!: () => void;
    const saves = [new Promise<void>((_, reject) => { rejectFirst = reject; }), new Promise<void>((resolve) => { resolveSecond = resolve; })];
    repo.savePreferenceImpl = () => saves.shift() ?? Promise.resolve();
    render(<PhraseBankApp repository={repo as never} />);
    await user.click(await screen.findByRole("button", { name: "设置" }));
    const autoSpeak = await screen.findByRole("checkbox", { name: "自动朗读答案" });
    await vi.waitFor(() => expect(autoSpeak).toBeEnabled());

    await user.click(autoSpeak);
    await user.click(screen.getByRole("radio", { name: "英式英语" }));
    resolveSecond();
    rejectFirst(new Error("older save failed"));
    await vi.waitFor(() => expect(repo.preferenceSaves).toHaveLength(2));
    expect(autoSpeak).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "英式英语" })).toBeChecked();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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
