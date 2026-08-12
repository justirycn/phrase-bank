"use client";

import { Component, lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { AppIcon } from "./components/AppIcon";
import { TrainingHome } from "./components/TrainingHome";
import type { PhraseInput, PhraseLearningState, TrainingMode } from "./domain/types";
import { createNewPhrase } from "./domain/review";
import { DAILY_NEW_PHRASE_LIMIT, previewLearningGroup } from "./domain/learningSelection";
import { calculateStreak, summarizeDailySentenceProgress, summarizeDailyTraining, summarizeWeek } from "./domain/trainingStats";
import { useHomeData } from "./hooks/useHomeData";
import { installBundledSystemContent } from "./services/systemContentInstaller";
import { LocalPhraseRepository } from "./storage/indexedDbRepository";
import type { PhraseRepository } from "./storage/repository";

type Screen = "home" | "library" | "add" | "learn" | "review" | "practice" | "settings";
type Repository = PhraseRepository;
type InitializationStatus = "loading" | "ready" | "error";
const defaultRepository = typeof window === "undefined" ? undefined : new LocalPhraseRepository();
const shanghaiDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const shanghaiTimestampDate = (timestamp: string) => { const value = new Date(timestamp); return Number.isNaN(value.getTime()) ? "" : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(value); };
const mondayOf = (date: string) => { const value = new Date(`${date}T00:00:00.000Z`); value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7)); return value.toISOString().slice(0, 10); };

export type AddSaveResult = { status: "saved" } | { status: "partial"; state: PhraseLearningState };

const loadLibraryScreen = () => import("./components/screens/LibraryScreen");
const loadAddPhraseScreen = () => import("./components/screens/AddPhraseScreen");
const loadSettingsScreen = () => import("./components/screens/SettingsScreen");
const loadReviewScreen = () => import("./components/screens/ReviewScreen");
const loadPracticeScreen = () => import("./components/screens/PracticeScreen");
const loadLearningScreen = () => import("./components/screens/LearningScreen");

function createLazyScreens() {
  return {
    Library: lazy(loadLibraryScreen),
    AddPhrase: lazy(loadAddPhraseScreen),
    Settings: lazy(loadSettingsScreen),
    Review: lazy(loadReviewScreen),
    PracticeSession: lazy(loadPracticeScreen),
    LearningSession: lazy(loadLearningScreen),
  };
}

function ScreenLoading({ screen }: { screen: Screen }) {
  const label = screen === "library" ? "句库" : screen === "add" ? "添加句子" : screen === "settings" ? "设置" : screen === "learn" ? "新句学习" : "训练";
  return <div className="screen-loading" role="status" aria-label={`正在打开${label}`}><div className="pulse" /><p>正在打开{label}…</p></div>;
}

class ScreenLoadBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div className="loading"><p role="alert">界面暂时无法加载，请重试。</p><button onClick={() => { this.setState({ failed: false }); this.props.onRetry(); }}>重新加载</button></div>;
    return this.props.children;
  }
}

export function PhraseBankApp({ repository, contentInstaller }: { repository?: Repository; contentInstaller?: (repository: Repository) => Promise<unknown> }) {
  const repo = repository ?? defaultRepository;
  const [screen, setScreen] = useState<Screen>("home");
  const [initialization, setInitialization] = useState<{ repository?: Repository; status: InitializationStatus; attempt: number; message?: string }>(() => ({ repository: repo, status: repo ? "loading" : "ready", attempt: 0 }));
  const initializationStatus: InitializationStatus = initialization.repository === repo ? initialization.status : repo ? "loading" : "ready";
  const initializationAttempt = initialization.repository === repo ? initialization.attempt : 0;
  const home = useHomeData(initializationStatus === "ready" ? repo : undefined);
  const phrases = home.data?.phrases ?? [];
  const categories = home.data?.categories ?? [];
  const due = home.data?.duePhrases ?? [];
  const trainingEvents = home.data?.events ?? [];
  const trainingSessions = home.data?.trainingSessions ?? [];
  const learningStates = home.data?.learningStates ?? [];
  const activeLearningSession = home.data?.activeLearningSession;
  const activeTrainingSession = home.data?.activeTrainingSession;
  const [trainingMode, setTrainingMode] = useState<TrainingMode>("standard");
  const [trainingRun, setTrainingRun] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [lazyScreens, setLazyScreens] = useState(createLazyScreens);
  const { Library, AddPhrase, LearningSession, Review, PracticeSession, Settings } = lazyScreens;
  const refresh = home.refresh;

  useEffect(() => {
    if (!repo) return;
    let current = true;
    const installer = contentInstaller ?? (repository ? undefined : installBundledSystemContent);
    void (async () => {
      await repo.initialize();
      if (installer) {
        try { await installer(repo); }
        catch { if (current) setNotice("系统句库暂时无法更新，个人句子和已有训练仍可正常使用。"); }
      }
      if (current) setInitialization({ repository: repo, status: "ready", attempt: initializationAttempt });
    })().catch((failure: unknown) => {
      const message = failure instanceof Error ? failure.message : String(failure);
      if (current) setInitialization({ repository: repo, status: "error", attempt: initializationAttempt, message });
    });
    return () => { current = false; };
  }, [contentInstaller, initializationAttempt, repo, repository]);

  const go = (next: Screen) => { setNotice(""); setError(""); setScreen(next); window.scrollTo?.(0, 0); };
  const startTraining = (mode: TrainingMode) => { setTrainingMode(mode); setTrainingRun((run) => run + 1); go("practice"); };
  const saveAddedPhrase = useCallback(async (input: PhraseInput, learnFirst: boolean): Promise<AddSaveResult> => {
    if (!repo) throw new Error("repository unavailable");
    const phrase = createNewPhrase(input);
    await repo.savePhrase(phrase);
    if (learnFirst) return { status: "saved" };
    const savedAt = new Date().toISOString();
    const state: PhraseLearningState = { phraseId: phrase.id, stage: "learned", firstSeenAt: savedAt, firstTestedAt: savedAt, consecutiveGood: 0, masteredDates: [], updatedAt: savedAt };
    try { await repo.savePhraseLearningState(state); return { status: "saved" }; }
    catch { return { status: "partial", state }; }
  }, [repo]);
  const retryAddedPhraseState = useCallback(async (state: PhraseLearningState) => {
    if (!repo) throw new Error("repository unavailable");
    await repo.savePhraseLearningState(state);
  }, [repo]);
  const completeAddedPhrase = useCallback(async () => {
    try { await refresh(); } catch { setError("句子已保存，但列表暂时无法刷新。"); }
    setNotice("已收入你的句库");
    setScreen("library");
  }, [refresh, setError, setNotice, setScreen]);
  if (screen === "home" && initializationStatus === "loading") return <main className="loading"><div className="pulse" /><p>正在打开你的语言块…</p></main>;
  if (screen === "home" && initializationStatus === "error") return <main className="loading"><p role="alert">本地数据暂时无法打开，请刷新后重试。{initialization.message}</p><button onClick={() => { setInitialization({ repository: repo, status: "loading", attempt: initializationAttempt + 1 }); }}>重试</button></main>;
  if (screen === "home" && !home.data && !home.error) return <main className="loading"><div className="pulse" /><p>正在打开你的语言块…</p></main>;
  if (screen === "home" && home.error && !home.data) return <main className="loading"><p role="alert">{home.error}</p><button onClick={() => { void home.retry(); }}>重试</button></main>;
  const today = shanghaiDate();
  const dailyProgress = summarizeDailySentenceProgress(today, trainingEvents);
  const trainingDays = [...new Set(trainingEvents.map((event) => shanghaiTimestampDate(event.occurredAt)))].map((date) => summarizeDailyTraining(date, trainingEvents, trainingSessions));
  const weeklySummary = summarizeWeek(trainingEvents, trainingSessions, mondayOf(today));
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const weeklyFocus = weeklySummary.weakPhraseIds.flatMap((id) => { const phrase = phrases.find((item) => item.id === id); return phrase ? [{ id, english: phrase.english, chinese: phrase.chinese, categoryName: categoryNames.get(phrase.categoryId) ?? "未分类" }] : []; });
  const newIntroducedToday = new Set(trainingEvents.filter((event) => event.source === "new" && shanghaiTimestampDate(event.occurredAt) === today).map((event) => event.phraseId)).size;
  const learnedToday = new Set(learningStates.filter((state) => state.firstTestedAt && shanghaiTimestampDate(state.firstTestedAt) === today).map((state) => state.phraseId)).size;
  const learningById = new Map(learningStates.map((state) => [state.phraseId, state]));
  const eligibleDue = due.filter((phrase) => ["learned", "mastered"].includes(learningById.get(phrase.id)?.stage ?? "unseen"));
  const preview = previewLearningGroup(phrases, learningStates, categories.map((category) => category.id), { date: today, remaining: Math.max(0, DAILY_NEW_PHRASE_LIMIT - learnedToday) });
  const nextThemeId = activeLearningSession?.themeCategoryId ?? preview.themeCategoryId;
  const phraseIds = new Set(phrases.map((phrase) => phrase.id));
  const activePhraseIds = activeLearningSession?.phraseIds.filter((id) => phraseIds.has(id));
  const activeCursor = activeLearningSession?.phase === "test" ? activeLearningSession.testIndex : activeLearningSession?.studyIndex ?? 0;
  const activeRemaining = activeLearningSession?.phraseIds.slice(activeCursor).filter((id) => phraseIds.has(id)).length;
  const nextLearningCount = activePhraseIds?.length ?? preview.phrases.length;
  const activeReviewRemaining = activeTrainingSession
    ? activeTrainingSession.phraseIds.slice(activeTrainingSession.currentIndex).filter((id) => phraseIds.has(id)).length
    : 0;
  const continueToday = () => {
    if (activeLearningSession) return go("learn");
    if (activeTrainingSession || eligibleDue.length > 0) return startTraining("standard");
    return go("learn");
  };

  return <div className="app-shell">
    <main className="app-main">
      {(error || home.error) && <div className="toast error" role="alert">{error || home.error}</div>}
      {notice && <div className="toast" role="status">{notice}</div>}
      {screen === "home" && <TrainingHome dailyProgress={dailyProgress} streak={calculateStreak(trainingDays, today)} weeklySummary={weeklySummary} focusPhrases={weeklyFocus} learnedToday={learnedToday} nextLearningCount={nextLearningCount} themeName={categoryNames.get(nextThemeId ?? "")} activeLearning={Boolean(activeLearningSession)} activeRemaining={activeRemaining} activeReview={Boolean(activeTrainingSession)} reviewRemaining={activeReviewRemaining} dueCount={eligibleDue.length} heatmapDays={home.data?.heatmap ?? []} heatmapError={home.data?.heatmapError} onRetryHeatmap={() => { void home.retryHeatmap(); }} onContinue={continueToday} onStartLearning={() => go("learn")} onStartStandard={() => startTraining("standard")} />}
      <ScreenLoadBoundary key={screen} onRetry={() => setLazyScreens(createLazyScreens())}><Suspense fallback={<ScreenLoading screen={screen} />}>{screen === "library" && <Library phrases={phrases} categories={categories} learningStates={learningStates} onDelete={async (id) => { if (!repo) return; await repo.deletePhrase(id); await refresh(); setNotice("已删除这条语言块"); }} onCopy={async (phrase) => { if (!repo) return; await repo.savePhrase(createNewPhrase({ english: phrase.english, chinese: phrase.chinese, categoryId: phrase.categoryId, sourceNote: "复制自系统句库" })); await refresh(); setNotice("已复制到我的句子"); }} onAdd={() => go("add")} />}
      {screen === "add" && <AddPhrase categories={categories} onCancel={() => go("library")} onSave={saveAddedPhrase} onRetryState={retryAddedPhraseState} onComplete={completeAddedPhrase} />}
      {screen === "learn" && repo && <LearningSession repository={repo} onHome={() => { go("home"); void refresh().catch(() => setError("本地数据暂时无法刷新，你仍然可以继续使用。")); }} />}
      {screen === "review" && <Review phrases={eligibleDue} onBack={() => go("home")} onGrade={async (id, result) => { if (!repo) return; await repo.submitReview(id, result); await refresh(); }} />}
      {screen === "practice" && repo && <PracticeSession key={`${trainingMode}-${trainingRun}`} repository={repo} mode={trainingMode} newIntroducedToday={newIntroducedToday} onHome={() => { go("home"); void refresh().catch(() => setError("本地数据暂时无法刷新，你仍然可以继续使用。")); }} onAgain={() => { setTrainingRun((run) => run + 1); void refresh().catch(() => setError("本地数据暂时无法刷新，请稍后再试。")); }} setError={setError} />}
      {screen === "settings" && repo && <Settings repository={repo} categories={categories} phrases={phrases} refresh={refresh} setNotice={setNotice} setError={setError} />}</Suspense></ScreenLoadBoundary>
    </main>
    {screen !== "learn" && screen !== "review" && screen !== "practice" && <nav className="bottom-nav" aria-label="主导航">
      <button className={screen === "home" ? "active" : ""} aria-current={screen === "home" ? "page" : undefined} onClick={() => go("home")}><span><AppIcon name="home" size={21} /></span>复习</button>
      <button className={screen === "library" ? "active" : ""} aria-current={screen === "library" ? "page" : undefined} onClick={() => go("library")}><span><AppIcon name="library" size={21} /></span>句库</button>
      <button className={screen === "add" ? "add-nav active" : "add-nav"} aria-label="添加" aria-current={screen === "add" ? "page" : undefined} onClick={() => go("add")}><span><AppIcon name="add" size={25} /></span>添加</button>
      <button className={screen === "settings" ? "active" : ""} aria-current={screen === "settings" ? "page" : undefined} onClick={() => go("settings")}><span><AppIcon name="settings" size={21} /></span>设置</button>
    </nav>}
  </div>;
}
