"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppIcon } from "./components/AppIcon";
import { SpeakingPractice } from "./components/SpeakingPractice";
import { TrainingHome } from "./components/TrainingHome";
import type { Category, Phrase, PhraseInput, ReviewResult, SpeechPreferences, TrainingEvent, TrainingMode, TrainingSessionRecord } from "./domain/types";
import { createNewPhrase } from "./domain/review";
import { calculateStreak, summarizeDailyTraining, summarizeWeek } from "./domain/trainingStats";
import { validateCategoryName, validatePhraseInput, type PhraseErrors } from "./domain/validation";
import { useTrainingSession } from "./hooks/useTrainingSession";
import { TemporaryRecorder } from "./services/recorder";
import { BrowserSpeechService } from "./services/speech";
import { backupFileName, parseBackup } from "./storage/backup";
import { LocalPhraseRepository } from "./storage/indexedDbRepository";
import type { PhraseRepository } from "./storage/repository";

type Screen = "home" | "library" | "add" | "review" | "practice" | "settings";
type Repository = PhraseRepository;
const defaultRepository = typeof window === "undefined" ? undefined : new LocalPhraseRepository();
const defaultSpeech = typeof window === "undefined" ? undefined : new BrowserSpeechService();
const defaultRecorder = typeof window === "undefined" ? undefined : new TemporaryRecorder();
const shanghaiDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const shanghaiTimestampDate = (timestamp: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(timestamp));
const mondayOf = (date: string) => { const value = new Date(`${date}T00:00:00.000Z`); value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7)); return value.toISOString().slice(0, 10); };

const masteryText = ["未掌握", "有印象", "可以使用", "已自动化"];
const formatDate = (iso: string) => new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(iso));

function Empty({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) {
  return <div className="empty"><div className="empty-glyph"><AppIcon name="bookmark" size={42} /></div><h3>{title}</h3><p>{detail}</p>{action}</div>;
}

export function PhraseBankApp({ repository }: { repository?: Repository }) {
  const repo = repository ?? defaultRepository;
  const [screen, setScreen] = useState<Screen>("home");
  const [phrases, setPhrases] = useState<Phrase[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [due, setDue] = useState<Phrase[]>([]);
  const [trainingEvents, setTrainingEvents] = useState<TrainingEvent[]>([]);
  const [trainingSessions, setTrainingSessions] = useState<TrainingSessionRecord[]>([]);
  const [trainingMode, setTrainingMode] = useState<TrainingMode>("standard");
  const [trainingRun, setTrainingRun] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!repo) return;
    const [nextPhrases, nextCategories, nextDue, nextEvents, snapshot] = await Promise.all([repo.listPhrases(), repo.listCategories(), repo.listDuePhrases(), repo.listTrainingEvents(), repo.exportSnapshot()]);
    setPhrases(nextPhrases); setCategories(nextCategories); setDue(nextDue); setTrainingEvents(nextEvents); setTrainingSessions(snapshot.trainingSessions);
  }, [repo]);

  useEffect(() => {
    if (!repo) return;
    repo.initialize().then(refresh).catch(() => setError("本地数据暂时无法打开，请刷新后重试。" )).finally(() => setLoading(false));
  }, [repo, refresh]);

  const go = (next: Screen) => { setNotice(""); setError(""); setScreen(next); window.scrollTo?.(0, 0); };
  const startTraining = (mode: TrainingMode) => { setTrainingMode(mode); setTrainingRun((run) => run + 1); go("practice"); };
  if (loading) return <main className="loading"><div className="pulse" /><p>正在打开你的语言块…</p></main>;
  const today = shanghaiDate();
  const dailySummary = summarizeDailyTraining(today, trainingEvents, trainingSessions);
  const trainingDays = [...new Set(trainingEvents.map((event) => shanghaiTimestampDate(event.occurredAt)))].map((date) => summarizeDailyTraining(date, trainingEvents, trainingSessions));
  const weeklySummary = summarizeWeek(trainingEvents, trainingSessions, mondayOf(today));
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const weeklyFocus = weeklySummary.weakPhraseIds.flatMap((id) => { const phrase = phrases.find((item) => item.id === id); return phrase ? [{ id, english: phrase.english, chinese: phrase.chinese, categoryName: categoryNames.get(phrase.categoryId) ?? "未分类" }] : []; });
  const newIntroducedToday = new Set(trainingEvents.filter((event) => event.source === "new" && shanghaiTimestampDate(event.occurredAt) === today).map((event) => event.phraseId)).size;

  return <div className="app-shell">
    <main className="app-main">
      {error && <div className="toast error" role="alert">{error}</div>}
      {notice && <div className="toast" role="status">{notice}</div>}
      {screen === "home" && <TrainingHome dailySummary={dailySummary} streak={calculateStreak(trainingDays, today)} weeklySummary={weeklySummary} focusPhrases={weeklyFocus} onStartStandard={() => startTraining("standard")} onStartQuick={() => startTraining("quick")} />}
      {screen === "library" && <Library phrases={phrases} categories={categories} onDelete={async (id) => { if (!repo) return; await repo.deletePhrase(id); await refresh(); setNotice("已删除这条语言块"); }} onAdd={() => go("add")} />}
      {screen === "add" && <AddPhrase categories={categories} onCancel={() => go("library")} onSave={async (input) => { if (!repo) return; await repo.savePhrase(createNewPhrase(input)); await refresh(); setNotice("已收入你的句库"); setScreen("library"); }} />}
      {screen === "review" && <Review phrases={due} onBack={() => go("home")} onGrade={async (id, result) => { if (!repo) return; await repo.submitReview(id, result); await refresh(); }} />}
      {screen === "practice" && repo && defaultSpeech && defaultRecorder && <PracticeSession key={`${trainingMode}-${trainingRun}`} repository={repo} mode={trainingMode} newIntroducedToday={newIntroducedToday} speech={defaultSpeech} recorder={defaultRecorder} onHome={() => { go("home"); void refresh().catch(() => setError("本地数据暂时无法刷新，你仍然可以继续使用。")); }} onAgain={() => { setTrainingRun((run) => run + 1); void refresh().catch(() => setError("本地数据暂时无法刷新，请稍后再试。")); }} setError={setError} />}
      {screen === "settings" && repo && <Settings repository={repo} categories={categories} phrases={phrases} refresh={refresh} setNotice={setNotice} setError={setError} />}
    </main>
    {screen !== "review" && screen !== "practice" && <nav className="bottom-nav" aria-label="主导航">
      <button className={screen === "home" ? "active" : ""} aria-current={screen === "home" ? "page" : undefined} onClick={() => go("home")}><span><AppIcon name="home" size={21} /></span>复习</button>
      <button className={screen === "library" ? "active" : ""} aria-current={screen === "library" ? "page" : undefined} onClick={() => go("library")}><span><AppIcon name="library" size={21} /></span>句库</button>
      <button className={screen === "add" ? "add-nav active" : "add-nav"} aria-label="添加" aria-current={screen === "add" ? "page" : undefined} onClick={() => go("add")}><span><AppIcon name="add" size={25} /></span>添加</button>
      <button className={screen === "settings" ? "active" : ""} aria-current={screen === "settings" ? "page" : undefined} onClick={() => go("settings")}><span><AppIcon name="settings" size={21} /></span>设置</button>
    </nav>}
  </div>;
}

function PracticeSession({ repository, mode, newIntroducedToday, speech, recorder, onHome, onAgain, setError }: {
  repository: PhraseRepository; mode: TrainingMode; speech: BrowserSpeechService; recorder: TemporaryRecorder;
  newIntroducedToday: number; onHome: () => Promise<void>; onAgain: () => void | Promise<void>; setError: (message: string) => void;
}) {
  const controller = useTrainingSession({ repository, mode, speech, recorder, newIntroducedToday });
  const { finish, phase } = controller;
  useEffect(() => {
    if (phase === "complete") void finish().catch(() => setError("训练进度暂时无法保存，请稍后重试。"));
  }, [finish, phase, setError]);
  return <SpeakingPractice controller={controller} onHome={() => void controller.finish().then(onHome).catch(() => setError("训练进度暂时无法保存，请稍后重试。"))} onAgain={() => void controller.finish().then(onAgain).catch(() => setError("训练进度暂时无法保存，请稍后重试。"))} />;
}

function AddPhrase({ categories, onSave, onCancel }: { categories: Category[]; onSave: (input: PhraseInput) => Promise<void>; onCancel: () => void }) {
  const [input, setInput] = useState<PhraseInput>({ english: "", chinese: "", categoryId: categories[0]?.id ?? "daily", personalExample: "", sourceNote: "" });
  const [errors, setErrors] = useState<PhraseErrors>({});
  const [more, setMore] = useState(false);
  const field = (key: keyof PhraseInput, value: string) => setInput((old) => ({ ...old, [key]: value }));
  const submit = async (event: React.FormEvent) => { event.preventDefault(); const next = validatePhraseInput(input); setErrors(next); if (Object.keys(next).length) return; await onSave(input); };
  return <><header className="screen-head"><button className="icon-button" onClick={onCancel} aria-label="返回"><AppIcon name="back" size={24} /></button><div><h1>收藏语言块</h1><p>Save a phrase you’ll actually use.</p></div></header>
    <form className="phrase-form" onSubmit={submit}>
      <label>英文表达<textarea aria-label="英文表达" value={input.english} onChange={(e) => field("english", e.target.value)} placeholder="e.g. I haven't decided yet." rows={3} />{errors.english && <small className="field-error">{errors.english}</small>}</label>
      <label>中文含义<textarea aria-label="中文含义" value={input.chinese} onChange={(e) => field("chinese", e.target.value)} placeholder="我还没决定。" rows={2} />{errors.chinese && <small className="field-error">{errors.chinese}</small>}</label>
      <label>分类<select aria-label="分类" value={input.categoryId} onChange={(e) => field("categoryId", e.target.value)}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>{errors.categoryId && <small className="field-error">{errors.categoryId}</small>}</label>
      <button className="more-button" type="button" onClick={() => setMore(!more)}>{more ? "收起选填内容" : <><AppIcon name="add" size={14} /> 添加我的例句或来源</>}</button>
      {more && <div className="optional-fields"><label>我的例句<textarea value={input.personalExample} onChange={(e) => field("personalExample", e.target.value)} rows={2} /></label><label>来源或备注<input value={input.sourceNote} onChange={(e) => field("sourceNote", e.target.value)} /></label></div>}
      <div className="form-actions"><button type="button" className="secondary" onClick={onCancel}>取消</button><button className="primary" type="submit" aria-label="保存语言块">保存语言块</button></div>
    </form></>;
}

function Library({ phrases, categories, onDelete, onAdd }: { phrases: Phrase[]; categories: Category[]; onDelete: (id: string) => Promise<void>; onAdd: () => void }) {
  const [query, setQuery] = useState(""); const [category, setCategory] = useState("all");
  const names = new Map(categories.map((c) => [c.id, c.name]));
  const filtered = useMemo(() => phrases.filter((p) => (category === "all" || p.categoryId === category) && `${p.english} ${p.chinese}`.toLowerCase().includes(query.trim().toLowerCase())), [phrases, query, category]);
  return <><header className="top"><div><h1>我的句库</h1><p>让收藏慢慢变成可以调用的表达。</p></div><button className="round-add" aria-label="在句库添加" onClick={onAdd}><AppIcon name="add" size={24} /></button></header>
    <div className="search"><span><AppIcon name="search" size={24} /></span><input aria-label="搜索语言块" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索英文或中文…" /></div>
    <div className="chips"><button className={category === "all" ? "selected" : ""} onClick={() => setCategory("all")}>全部 {phrases.length}</button>{categories.map((c) => <button key={c.id} className={category === c.id ? "selected" : ""} onClick={() => setCategory(c.id)}>{c.name}</button>)}</div>
    <ul className="library-reading-list" aria-label="语言块阅读列表">{filtered.map((phrase) => <li className="library-row" key={phrase.id}><article><div className="row-meta"><span>{names.get(phrase.categoryId)}</span><small>{masteryText[phrase.masteryLevel] ?? masteryText[0]}</small></div><h3 className="phrase-english">{phrase.english}</h3><p>{phrase.chinese}</p>{phrase.personalExample && <blockquote>{phrase.personalExample}</blockquote>}<div className="row-foot"><small>下次复习 · {formatDate(phrase.nextReviewAt)}</small><button onClick={async () => { if (confirm("确定删除这条语言块吗？")) await onDelete(phrase.id); }}>删除</button></div></article></li>)}</ul>
    {!filtered.length && <Empty title={phrases.length ? "没有找到匹配内容" : "句库还是空的"} detail={phrases.length ? "换个关键词或分类试试看。" : "每收藏一句，你都在建立自己的表达库存。"} action={!phrases.length ? <button className="secondary" onClick={onAdd}>添加第一条</button> : undefined} />}
  </>;
}

function Review({ phrases, onBack, onGrade }: { phrases: Phrase[]; onBack: () => void; onGrade: (id: string, result: ReviewResult) => Promise<void> }) {
  const [index, setIndex] = useState(0); const [revealed, setRevealed] = useState(false); const [counts, setCounts] = useState({ again: 0, hard: 0, good: 0 });
  const phrase = phrases[index];
  const grade = async (result: ReviewResult) => { if (!phrase) return; await onGrade(phrase.id, result); setCounts((old) => ({ ...old, [result]: old[result] + 1 })); setIndex((i) => i + 1); setRevealed(false); };
  if (!phrase) return <div className="review-done"><div className="done-mark"><AppIcon name="completion" size={36} /></div><h1>今天完成了</h1><p>复习了 {index} 条语言块。主动回忆一次，就离自然表达更近一点。</p><div className="summary"><span>不会 <b>{counts.again}</b></span><span>模糊 <b>{counts.hard}</b></span><span>掌握 <b>{counts.good}</b></span></div><button className="primary" onClick={onBack}>回到首页</button></div>;
  return <div className="review-screen"><header><button className="icon-button" onClick={onBack} aria-label="退出复习"><AppIcon name="close" size={24} /></button><div className="progress"><span style={{ width: `${((index + (revealed ? .5 : 0)) / phrases.length) * 100}%` }} /></div><small>{index + 1} / {phrases.length}</small></header><div className="review-card"><small>中文提示</small><h1>{phrase.chinese}</h1>{revealed ? <div className="answer"><i /><small>自然表达</small><h2>{phrase.english}</h2>{phrase.personalExample && <p>{phrase.personalExample}</p>}</div> : <><p>先在心里或开口说出英文</p><button className="reveal" onClick={() => setRevealed(true)} aria-label="显示英文答案">显示英文答案</button></>}</div>{revealed && <div className="grade-row"><button className="again" onClick={() => grade("again")}><b>不会</b><small>10 分钟后</small></button><button className="hard" onClick={() => grade("hard")}><b>模糊</b><small>明天再见</small></button><button className="good" onClick={() => grade("good")}><b>掌握</b><small>延长间隔</small></button></div>}</div>;
}

function Settings({ repository, categories, phrases, refresh, setNotice, setError }: { repository: Repository; categories: Category[]; phrases: Phrase[]; refresh: () => Promise<void>; setNotice: (s: string) => void; setError: (s: string) => void }) {
  const [name, setName] = useState("");
  const [speechPreferences, setSpeechPreferences] = useState<SpeechPreferences>({ accent: "en-US", autoSpeak: false });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    repository.getSpeechPreferences()
      .then((preferences) => { if (mounted.current) setSpeechPreferences(preferences); })
      .catch(() => { if (mounted.current) setError("语音偏好暂时无法读取，已使用默认设置。"); });
    return () => { mounted.current = false; };
  }, [repository, setError]);
  const saveSpeechPreferences = (preferences: SpeechPreferences) => {
    setSpeechPreferences(preferences);
    void repository.saveSpeechPreferences(preferences)
      .catch(() => { if (mounted.current) setError("语音偏好暂时无法保存，请稍后再试。"); });
  };
  const addCategory = async () => { const error = validateCategoryName(name, categories.map((c) => c.name)); if (error) return setError(error); const now = new Date().toISOString(); await repository.saveCategory({ id: crypto.randomUUID(), name: name.trim(), isDefault: false, createdAt: now, updatedAt: now }); setName(""); await refresh(); setNotice("分类已添加"); };
  const exportData = async () => { const snapshot = await repository.exportSnapshot(); const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = backupFileName(); link.click(); URL.revokeObjectURL(url); setNotice("备份文件已导出"); };
  const importData = async (file?: File) => { if (!file) return; try { const backup = parseBackup(await file.text()); const policy = confirm("遇到重复记录时，用备份中的内容覆盖吗？\n选择“取消”将跳过重复项。") ? "overwrite" : "skip"; await repository.importSnapshot(backup, policy); await refresh(); setNotice("备份已成功导入"); } catch (e) { setError(e instanceof Error ? e.message : "导入失败"); } };
  return <><header className="top"><div><h1>设置</h1><p>管理你的分类与本地数据。</p></div></header>
    <section className="settings-card"><div className="section-title"><div><span>分类管理</span><small>{categories.length} 个分类</small></div></div><div className="category-list">{categories.map((c) => <div key={c.id}><span className="category-dot" /><b>{c.name}</b><small>{phrases.filter((p) => p.categoryId === c.id).length} 条</small>{!c.isDefault && <button onClick={async () => { const target = categories.find((x) => x.id !== c.id); if (!target || !confirm(`删除“${c.name}”并将内容移到“${target.name}”？`)) return; await repository.deleteCategoryAndMigrate(c.id, target.id); await refresh(); }}>删除</button>}</div>)}</div><div className="add-category"><input aria-label="新分类名称" value={name} onChange={(e) => setName(e.target.value)} placeholder="新分类名称" /><button onClick={addCategory}>添加</button></div></section>
    <section className="settings-card speech-settings"><div className="section-title"><div><span>语音训练</span><small>SPEAKING PRACTICE</small></div></div>
      <label className="speech-toggle"><span><b>自动朗读答案</b><small>显示英文后自动播放发音</small></span><input aria-label="自动朗读答案" type="checkbox" checked={speechPreferences.autoSpeak} onChange={(event) => saveSpeechPreferences({ ...speechPreferences, autoSpeak: event.target.checked })} /></label>
      <fieldset className="accent-options"><legend>朗读口音</legend><label><input type="radio" name="speech-accent" value="en-US" checked={speechPreferences.accent === "en-US"} onChange={() => saveSpeechPreferences({ ...speechPreferences, accent: "en-US" })} /><span>美式英语</span></label><label><input type="radio" name="speech-accent" value="en-GB" checked={speechPreferences.accent === "en-GB"} onChange={() => saveSpeechPreferences({ ...speechPreferences, accent: "en-GB" })} /><span>英式英语</span></label></fieldset>
    </section>
    <section className="settings-card"><div className="section-title"><div><span>数据备份</span><small>BACKUP & RESTORE</small></div></div><div className="warning"><b>数据只保存在当前设备</b><p>更换设备、卸载浏览器或清除网站数据前，请先导出备份。</p></div><button className="settings-action" onClick={exportData}><span><AppIcon name="download" size={20} /></span><div><b>导出备份</b><small>下载完整 JSON 文件</small></div><i><AppIcon name="next" size={20} /></i></button><label className="settings-action"><span><AppIcon name="upload" size={20} /></span><div><b>导入备份</b><small>从以前的备份恢复</small></div><i><AppIcon name="next" size={20} /></i><input type="file" accept="application/json,.json" onChange={(e) => importData(e.target.files?.[0])} hidden /></label></section>
    <p className="version">Phrase Bank · 本地版 MVP</p>
  </>;
}
