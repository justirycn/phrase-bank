"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AppIcon } from "./AppIcon";
import { NewPhraseLearning } from "./NewPhraseLearning";
import { SpeakingPractice } from "./SpeakingPractice";
import type { Category, LearningStage, Phrase, PhraseInput, PhraseLearningState, ReviewResult, SpeechPreferences, TrainingMode } from "../domain/types";
import { DAILY_NEW_PHRASE_LIMIT } from "../domain/learningSelection";
import { validateCategoryName, validatePhraseInput, type PhraseErrors } from "../domain/validation";
import { useTrainingSession } from "../hooks/useTrainingSession";
import { useNewPhraseLearning } from "../hooks/useNewPhraseLearning";
import { TemporaryRecorder } from "../services/recorder";
import { BrowserSpeechService } from "../services/speech";
import { backupFileName, parseBackup } from "../storage/backup";
import type { PhraseRepository } from "../storage/repository";

const defaultSpeech = new BrowserSpeechService();
const defaultRecorder = new TemporaryRecorder();
const defaultSpeechPreferences: SpeechPreferences = { accent: "en-US", autoSpeak: true };
type Repository = PhraseRepository;
const masteryText = ["未掌握", "有印象", "可以使用", "已自动化"];
const formatDate = (iso: string) => new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(iso));

function Empty({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) {
  return <div className="empty"><div className="empty-glyph"><AppIcon name="bookmark" size={42} /></div><h3>{title}</h3><p>{detail}</p>{action}</div>;
}

export function LearningSession({ repository, onHome }: { repository: PhraseRepository; onHome: () => void }) {
  const speech = defaultSpeech;
  const controller = useNewPhraseLearning({ repository, speech, dailyLimit: DAILY_NEW_PHRASE_LIMIT });
  return <NewPhraseLearning controller={controller} onHome={onHome} />;
}

export function PracticeSession({ repository, mode, newIntroducedToday, onHome, onAgain, setError }: {
  repository: PhraseRepository; mode: TrainingMode;
  newIntroducedToday: number; onHome: () => Promise<void>; onAgain: () => void | Promise<void>; setError: (message: string) => void;
}) {
  const controller = useTrainingSession({ repository, mode, speech: defaultSpeech, recorder: defaultRecorder, newIntroducedToday });
  const { finish, phase } = controller;
  useEffect(() => {
    if (phase === "complete") void finish().catch(() => setError("训练进度暂时无法保存，请稍后重试。"));
  }, [finish, phase, setError]);
  return <SpeakingPractice controller={controller} onHome={() => void controller.finish().then(onHome).catch(() => setError("训练进度暂时无法保存，请稍后重试。"))} onAgain={() => void controller.finish().then(onAgain).catch(() => setError("训练进度暂时无法保存，请稍后重试。"))} />;
}

export type AddSaveResult = { status: "saved" } | { status: "partial"; state: PhraseLearningState };

function resetAddPhraseVisibleScope(setSaving: (value: boolean) => void, setSaveError: (value: string) => void, hasPartial: boolean) {
  setSaving(false);
  setSaveError(hasPartial ? "句子已保存，但设置为已学习失败，目前按未学习处理。" : "");
}

export function AddPhrase({ categories, onSave, onRetryState, onComplete, onCancel }: { categories: Category[]; onSave: (input: PhraseInput, learnFirst: boolean) => Promise<AddSaveResult>; onRetryState: (state: PhraseLearningState) => Promise<void>; onComplete: () => Promise<void>; onCancel: () => void }) {
  const [input, setInput] = useState<PhraseInput>({ english: "", chinese: "", categoryId: categories[0]?.id ?? "daily", personalExample: "", sourceNote: "" });
  const [errors, setErrors] = useState<PhraseErrors>({});
  const [more, setMore] = useState(false);
  const [learnFirst, setLearnFirst] = useState(true);
  const [saveError, setSaveError] = useState("");
  const [partialState, setPartialState] = useState<PhraseLearningState>();
  const [saving, setSaving] = useState(false);
  const operationRef = useRef<symbol>();
  const partialRef = useRef<PhraseLearningState>();
  const mountedRef = useRef(true);
  const scopeRef = useRef({ onSave, onRetryState, onComplete });
  const scopeGenerationRef = useRef(0);
  useLayoutEffect(() => {
    scopeRef.current = { onSave, onRetryState, onComplete };
    scopeGenerationRef.current += 1;
    operationRef.current = undefined;
    resetAddPhraseVisibleScope(setSaving, setSaveError, Boolean(partialRef.current));
  }, [onComplete, onRetryState, onSave]);
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      scopeGenerationRef.current += 1;
      operationRef.current = undefined;
    };
  }, []);
  const field = (key: keyof PhraseInput, value: string) => setInput((old) => ({ ...old, [key]: value }));
  const submit = async (event: React.FormEvent) => { event.preventDefault(); if (operationRef.current || partialRef.current) return; const token = Symbol("phrase-save"); const scope = scopeGenerationRef.current; operationRef.current = token; setSaving(true); const next = validatePhraseInput(input); setErrors(next); if (Object.keys(next).length) { operationRef.current = undefined; setSaving(false); return; } setSaveError(""); try { const result = await onSave(input, learnFirst); if (!mountedRef.current || operationRef.current !== token || scopeGenerationRef.current !== scope) return; if (result.status === "partial") { partialRef.current = result.state; setPartialState(result.state); setSaveError("句子已保存，但设置为已学习失败，目前按未学习处理。"); } else { await onComplete(); } } catch { if (mountedRef.current && operationRef.current === token && scopeGenerationRef.current === scope) setSaveError("句子保存失败，请检查本地存储后重试。"); } finally { if (operationRef.current === token) { operationRef.current = undefined; if (mountedRef.current) setSaving(false); } } };
  const retryState = async () => { if (operationRef.current || !partialRef.current) return; const token = Symbol("state-retry"); const scope = scopeGenerationRef.current; const state = partialRef.current; operationRef.current = token; setSaving(true); setSaveError(""); try { await onRetryState(state); if (!mountedRef.current || operationRef.current !== token || scopeGenerationRef.current !== scope) return; await onComplete(); } catch { if (mountedRef.current && operationRef.current === token && scopeGenerationRef.current === scope) setSaveError("已保存句子，但设置为已学习仍然失败，请重试。"); } finally { if (operationRef.current === token) { operationRef.current = undefined; if (mountedRef.current) setSaving(false); } } };
  return <><header className="screen-head"><button className="icon-button" onClick={onCancel} aria-label="返回"><AppIcon name="back" size={24} /></button><div><h1>收藏语言块</h1><p>Save a phrase you’ll actually use.</p></div></header>
    <form className="phrase-form" onSubmit={submit}>
      <label>英文表达<textarea aria-label="英文表达" value={input.english} onChange={(e) => field("english", e.target.value)} placeholder="e.g. I haven't decided yet." rows={3} />{errors.english && <small className="field-error">{errors.english}</small>}</label>
      <label>中文含义<textarea aria-label="中文含义" value={input.chinese} onChange={(e) => field("chinese", e.target.value)} placeholder="我还没决定。" rows={2} />{errors.chinese && <small className="field-error">{errors.chinese}</small>}</label>
      <label>分类<select aria-label="分类" value={input.categoryId} onChange={(e) => field("categoryId", e.target.value)}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>{errors.categoryId && <small className="field-error">{errors.categoryId}</small>}</label>
      <button className="more-button" type="button" onClick={() => setMore(!more)}>{more ? "收起选填内容" : <><AppIcon name="add" size={14} /> 添加我的例句或来源</>}</button>
      {more && <div className="optional-fields"><label>我的例句<textarea value={input.personalExample} onChange={(e) => field("personalExample", e.target.value)} rows={2} /></label><label>来源或备注<input value={input.sourceNote} onChange={(e) => field("sourceNote", e.target.value)} /></label></div>}
      <label><input type="checkbox" checked={learnFirst} onChange={(event) => setLearnFirst(event.target.checked)} />先在“学习新句”里认识这句话</label>
      {saveError && <p className="field-error" role="alert">{saveError}</p>}
      {partialState && <button type="button" disabled={saving} onClick={() => { void retryState(); }}>只重试学习状态</button>}
      <div className="form-actions"><button type="button" className="secondary" onClick={onCancel}>取消</button><button className="primary" type="submit" aria-label="保存语言块" disabled={saving || Boolean(partialState)}>{saving ? "正在保存" : "保存语言块"}</button></div>
    </form></>;
}

export function Library({ phrases, categories, learningStates, onDelete, onCopy, onAdd }: { phrases: Phrase[]; categories: Category[]; learningStates: PhraseLearningState[]; onDelete: (id: string) => Promise<void>; onCopy: (phrase: Phrase) => Promise<void>; onAdd: () => void }) {
  const [tab, setTab] = useState<"personal" | "system">("personal");
  const [query, setQuery] = useState(""); const [category, setCategory] = useState("all");
  const [stage, setStage] = useState<LearningStage | "all">("all");
  const [visibleCount, setVisibleCount] = useState(50);
  const names = new Map(categories.map((c) => [c.id, c.name]));
  const tabPhrases = useMemo(() => phrases.filter((phrase) => tab === "system" ? phrase.origin === "system" && phrase.kind === "core" && !phrase.retiredAt : (phrase.origin ?? "personal") === "personal"), [phrases, tab]);
  const stateById = useMemo(() => new Map(learningStates.map((state) => [state.phraseId, state])), [learningStates]);
  const filtered = useMemo(() => tabPhrases.filter((p) => (category === "all" || p.categoryId === category) && (tab !== "system" || stage === "all" || (stateById.get(p.id)?.stage ?? "unseen") === stage) && `${p.english} ${p.chinese} ${p.subcategory ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())), [tabPhrases, query, category, stage, stateById, tab]);
  const visible = filtered.slice(0, visibleCount);
  return <><header className="top"><div><h1>{tab === "personal" ? "我的句子" : "系统句库"}</h1><p>{tab === "personal" ? "优先练习你真正想说的表达。" : "600 个核心语言块，案例将随掌握逐步解锁。"}</p></div>{tab === "personal" && <button className="round-add" aria-label="在句库添加" onClick={onAdd}><AppIcon name="add" size={24} /></button>}</header>
    <div className="library-tabs" role="tablist" aria-label="句库类型"><button role="tab" aria-selected={tab === "personal"} onClick={() => { setTab("personal"); setCategory("all"); setStage("all"); setVisibleCount(50); }}>我的句子</button><button role="tab" aria-selected={tab === "system"} onClick={() => { setTab("system"); setCategory("all"); setStage("all"); setVisibleCount(50); }}>系统句库</button></div>
    <div className="search"><span><AppIcon name="search" size={24} /></span><input aria-label="搜索语言块" value={query} onChange={(e) => { setQuery(e.target.value); setVisibleCount(50); }} placeholder="搜索英文或中文…" /></div>
    <div className="chips"><button className={category === "all" ? "selected" : ""} onClick={() => { setCategory("all"); setVisibleCount(50); }}>全部 {tabPhrases.length}</button>{categories.map((c) => <button key={c.id} className={category === c.id ? "selected" : ""} onClick={() => { setCategory(c.id); setVisibleCount(50); }}>{c.name}</button>)}</div>
    {tab === "system" && <div className="chips" aria-label="学习阶段">{([['unseen', '未学习'], ['learning', '学习中'], ['learned', '已学习'], ['mastered', '已掌握']] as const).map(([value, label]) => <button key={value} className={stage === value ? "selected" : ""} aria-pressed={stage === value} onClick={() => { setStage(stage === value ? "all" : value); setVisibleCount(50); }}>{label}</button>)}</div>}
    <ul className="library-reading-list" aria-label={tab === "personal" ? "我的语言块列表" : "系统语言块列表"}>{visible.map((phrase) => <li className="library-row" key={phrase.id}><article><div className="row-meta"><span>{names.get(phrase.categoryId)}{phrase.subcategory ? ` · ${phrase.subcategory.replaceAll("-", " ")}` : ""}</span><small>{phrase.cefrLevel ?? masteryText[phrase.masteryLevel] ?? masteryText[0]}</small></div><h3 className="phrase-english">{phrase.english}</h3><p>{phrase.chinese}</p>{phrase.personalExample && <blockquote>{phrase.personalExample}</blockquote>}<div className="row-foot"><small>{tab === "system" ? "系统内容 · 案例逐步解锁" : `下次复习 · ${formatDate(phrase.nextReviewAt)}`}</small>{tab === "system" ? <button onClick={() => onCopy(phrase)}>复制到我的句子</button> : <button onClick={async () => { if (confirm("确定删除这条语言块吗？")) await onDelete(phrase.id); }}>删除</button>}</div></article></li>)}</ul>
    {visible.length < filtered.length && <button className="secondary library-more" onClick={() => setVisibleCount((count) => count + 50)}>再显示 {Math.min(50, filtered.length - visible.length)} 条</button>}
    {!filtered.length && <Empty title={tabPhrases.length ? "没有找到匹配内容" : tab === "personal" ? "句库还是空的" : "系统句库尚未安装"} detail={tabPhrases.length ? "换个关键词或分类试试看。" : tab === "personal" ? "每收藏一句，你都在建立自己的表达库存。" : "联网刷新后会自动安全安装。"} action={tab === "personal" && !tabPhrases.length ? <button className="secondary" onClick={onAdd}>添加第一条</button> : undefined} />}
  </>;
}

export function Review({ phrases, onBack, onGrade }: { phrases: Phrase[]; onBack: () => void; onGrade: (id: string, result: ReviewResult) => Promise<void> }) {
  const [index, setIndex] = useState(0); const [revealed, setRevealed] = useState(false); const [counts, setCounts] = useState({ again: 0, hard: 0, good: 0 });
  const phrase = phrases[index];
  const grade = async (result: ReviewResult) => { if (!phrase) return; await onGrade(phrase.id, result); setCounts((old) => ({ ...old, [result]: old[result] + 1 })); setIndex((i) => i + 1); setRevealed(false); };
  if (!phrase) return <div className="review-done"><div className="done-mark"><AppIcon name="completion" size={36} /></div><h1>今天完成了</h1><p>复习了 {index} 条语言块。主动回忆一次，就离自然表达更近一点。</p><div className="summary"><span>不会 <b>{counts.again}</b></span><span>模糊 <b>{counts.hard}</b></span><span>掌握 <b>{counts.good}</b></span></div><button className="primary" onClick={onBack}>回到首页</button></div>;
  return <div className="review-screen"><header><button className="icon-button" onClick={onBack} aria-label="退出复习"><AppIcon name="close" size={24} /></button><div className="progress"><span style={{ width: `${((index + (revealed ? .5 : 0)) / phrases.length) * 100}%` }} /></div><small>{index + 1} / {phrases.length}</small></header><div className="review-card"><small>中文提示</small><h1>{phrase.chinese}</h1>{revealed ? <div className="answer"><i /><small>自然表达</small><h2>{phrase.english}</h2>{phrase.personalExample && <p>{phrase.personalExample}</p>}</div> : <><p>先在心里或开口说出英文</p><button className="reveal" onClick={() => setRevealed(true)} aria-label="显示英文答案">显示英文答案</button></>}</div>{revealed && <div className="grade-row"><button className="again" onClick={() => grade("again")}><b>不会</b><small>10 分钟后</small></button><button className="hard" onClick={() => grade("hard")}><b>模糊</b><small>明天再见</small></button><button className="good" onClick={() => grade("good")}><b>掌握</b><small>延长间隔</small></button></div>}</div>;
}

export function Settings({ repository, categories, phrases, refresh, setNotice, setError }: { repository: Repository; categories: Category[]; phrases: Phrase[]; refresh: () => Promise<void>; setNotice: (s: string) => void; setError: (s: string) => void }) {
  const [name, setName] = useState("");
  const [speechSettings, setSpeechSettings] = useState(() => ({ repository, preferences: defaultSpeechPreferences, loading: true }));
  const speechPreferences = speechSettings.repository === repository ? speechSettings.preferences : defaultSpeechPreferences;
  const speechPreferencesLoading = speechSettings.repository !== repository || speechSettings.loading;
  const mounted = useRef(true);
  const loadGeneration = useRef(0);
  const saveSequence = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const persistedPreferences = useRef<SpeechPreferences>(defaultSpeechPreferences);
  useEffect(() => {
    const generation = ++loadGeneration.current;
    mounted.current = true;
    saveSequence.current = 0;
    saveQueue.current = Promise.resolve();
    persistedPreferences.current = defaultSpeechPreferences;
    repository.getSpeechPreferences()
      .then((preferences) => {
        if (!mounted.current || loadGeneration.current !== generation) return;
        persistedPreferences.current = preferences;
        setSpeechSettings({ repository, preferences, loading: false });
      })
      .catch(() => {
        if (!mounted.current || loadGeneration.current !== generation) return;
        setSpeechSettings({ repository, preferences: defaultSpeechPreferences, loading: false });
        setError("语音偏好暂时无法读取，已使用默认设置。");
      });
    return () => { mounted.current = false; loadGeneration.current += 1; };
  }, [repository, setError]);
  const saveSpeechPreferences = (preferences: SpeechPreferences) => {
    const generation = loadGeneration.current;
    const sequence = ++saveSequence.current;
    setSpeechSettings({ repository, preferences, loading: false });
    const persist = async () => {
      try {
        await repository.saveSpeechPreferences(preferences);
        if (!mounted.current || loadGeneration.current !== generation) return;
        persistedPreferences.current = preferences;
      } catch {
        if (!mounted.current || loadGeneration.current !== generation || sequence !== saveSequence.current) return;
        setSpeechSettings({ repository, preferences: persistedPreferences.current, loading: false });
        setError("语音偏好暂时无法保存，已恢复上次设置。");
      }
    };
    saveQueue.current = saveQueue.current.then(persist, persist);
  };
  const addCategory = async () => { const error = validateCategoryName(name, categories.map((c) => c.name)); if (error) return setError(error); const now = new Date().toISOString(); await repository.saveCategory({ id: crypto.randomUUID(), name: name.trim(), isDefault: false, createdAt: now, updatedAt: now }); setName(""); await refresh(); setNotice("分类已添加"); };
  const exportData = async () => { const snapshot = await repository.exportSnapshot(); const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = backupFileName(); link.click(); URL.revokeObjectURL(url); setNotice("备份文件已导出"); };
  const importData = async (file?: File) => { if (!file) return; try { const backup = parseBackup(await file.text()); const policy = confirm("遇到重复记录时，用备份中的内容覆盖吗？\n选择“取消”将跳过重复项。") ? "overwrite" : "skip"; await repository.importSnapshot(backup, policy); await refresh(); setNotice("备份已成功导入"); } catch (e) { setError(e instanceof Error ? e.message : "导入失败"); } };
  return <><header className="top"><div><h1>设置</h1><p>管理你的分类与本地数据。</p></div></header>
    <section className="settings-card"><div className="section-title"><div><span>分类管理</span><small>{categories.length} 个分类</small></div></div><div className="category-list">{categories.map((c) => <div key={c.id}><span className="category-dot" /><b>{c.name}</b><small>{phrases.filter((p) => p.categoryId === c.id).length} 条</small>{!c.isDefault && <button onClick={async () => { const target = categories.find((x) => x.id !== c.id); if (!target || !confirm(`删除“${c.name}”并将内容移到“${target.name}”？`)) return; await repository.deleteCategoryAndMigrate(c.id, target.id); await refresh(); }}>删除</button>}</div>)}</div><div className="add-category"><input aria-label="新分类名称" value={name} onChange={(e) => setName(e.target.value)} placeholder="新分类名称" /><button onClick={addCategory}>添加</button></div></section>
    <section className="settings-card speech-settings"><div className="section-title"><div><span>语音训练</span><small>SPEAKING PRACTICE</small></div></div>
      <label className="speech-toggle"><span><b>自动朗读答案</b><small>显示英文后自动播放发音</small></span><input aria-label="自动朗读答案" type="checkbox" disabled={speechPreferencesLoading} checked={speechPreferences.autoSpeak} onChange={(event) => saveSpeechPreferences({ ...speechPreferences, autoSpeak: event.target.checked })} /></label>
      <fieldset className="accent-options" disabled={speechPreferencesLoading}><legend>朗读口音</legend><label><input type="radio" name="speech-accent" value="en-US" checked={speechPreferences.accent === "en-US"} onChange={() => saveSpeechPreferences({ ...speechPreferences, accent: "en-US" })} /><span>美式英语</span></label><label><input type="radio" name="speech-accent" value="en-GB" checked={speechPreferences.accent === "en-GB"} onChange={() => saveSpeechPreferences({ ...speechPreferences, accent: "en-GB" })} /><span>英式英语</span></label></fieldset>
    </section>
    <section className="settings-card"><div className="section-title"><div><span>数据备份</span><small>BACKUP & RESTORE</small></div></div><div className="warning"><b>数据只保存在当前设备</b><p>更换设备、卸载浏览器或清除网站数据前，请先导出备份。</p></div><button className="settings-action" onClick={exportData}><span><AppIcon name="download" size={20} /></span><div><b>导出备份</b><small>下载完整 JSON 文件</small></div><i><AppIcon name="next" size={20} /></i></button><label className="settings-action"><span><AppIcon name="upload" size={20} /></span><div><b>导入备份</b><small>从以前的备份恢复</small></div><i><AppIcon name="next" size={20} /></i><input type="file" accept="application/json,.json" onChange={(e) => importData(e.target.files?.[0])} hidden /></label></section>
    <p className="version">Phrase Bank · 本地版 MVP</p>
  </>;
}
