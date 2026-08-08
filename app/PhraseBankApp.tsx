"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppIcon } from "./components/AppIcon";
import { Brand } from "./components/Brand";
import type { BackupEnvelope, Category, Phrase, PhraseInput, ReviewResult } from "./domain/types";
import { createNewPhrase } from "./domain/review";
import { validateCategoryName, validatePhraseInput, type PhraseErrors } from "./domain/validation";
import { backupFileName, parseBackup } from "./storage/backup";
import { LocalPhraseRepository } from "./storage/indexedDbRepository";

type Screen = "home" | "library" | "add" | "review" | "settings";
type Repository = LocalPhraseRepository;
const defaultRepository = typeof window === "undefined" ? undefined : new LocalPhraseRepository();

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
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!repo) return;
    const [nextPhrases, nextCategories, nextDue] = await Promise.all([repo.listPhrases(), repo.listCategories(), repo.listDuePhrases()]);
    setPhrases(nextPhrases); setCategories(nextCategories); setDue(nextDue);
  }, [repo]);

  useEffect(() => {
    if (!repo) return;
    repo.initialize().then(refresh).catch(() => setError("本地数据暂时无法打开，请刷新后重试。" )).finally(() => setLoading(false));
  }, [repo, refresh]);

  const go = (next: Screen) => { setNotice(""); setError(""); setScreen(next); window.scrollTo?.(0, 0); };
  if (loading) return <main className="loading"><div className="pulse" /><p>正在打开你的语言块…</p></main>;

  return <div className="app-shell">
    <main className="app-main">
      {error && <div className="toast error" role="alert">{error}</div>}
      {notice && <div className="toast" role="status">{notice}</div>}
      {screen === "home" && <Home phrases={phrases} dueCount={due.length} categories={categories} onReview={() => go("review")} onAdd={() => go("add")} />}
      {screen === "library" && <Library phrases={phrases} categories={categories} onDelete={async (id) => { if (!repo) return; await repo.deletePhrase(id); await refresh(); setNotice("已删除这条语言块"); }} onAdd={() => go("add")} />}
      {screen === "add" && <AddPhrase categories={categories} onCancel={() => go("library")} onSave={async (input) => { if (!repo) return; await repo.savePhrase(createNewPhrase(input)); await refresh(); setNotice("已收入你的句库"); setScreen("library"); }} />}
      {screen === "review" && <Review phrases={due} onBack={() => go("home")} onGrade={async (id, result) => { if (!repo) return; await repo.submitReview(id, result); await refresh(); }} />}
      {screen === "settings" && repo && <Settings repository={repo} categories={categories} phrases={phrases} refresh={refresh} setNotice={setNotice} setError={setError} />}
    </main>
    {screen !== "review" && <nav className="bottom-nav" aria-label="主导航">
      <button className={screen === "home" ? "active" : ""} aria-current={screen === "home" ? "page" : undefined} onClick={() => go("home")}><span><AppIcon name="home" size={21} /></span>复习</button>
      <button className={screen === "library" ? "active" : ""} aria-current={screen === "library" ? "page" : undefined} onClick={() => go("library")}><span><AppIcon name="library" size={21} /></span>句库</button>
      <button className={screen === "add" ? "add-nav active" : "add-nav"} aria-label="添加" aria-current={screen === "add" ? "page" : undefined} onClick={() => go("add")}><span><AppIcon name="add" size={25} /></span>添加</button>
      <button className={screen === "settings" ? "active" : ""} aria-current={screen === "settings" ? "page" : undefined} onClick={() => go("settings")}><span><AppIcon name="settings" size={21} /></span>设置</button>
    </nav>}
  </div>;
}

function Home({ phrases, dueCount, categories, onReview, onAdd }: { phrases: Phrase[]; dueCount: number; categories: Category[]; onReview: () => void; onAdd: () => void }) {
  const names = new Map(categories.map((c) => [c.id, c.name]));
  const today = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).formatToParts(new Date());
  const date = today.filter((part) => part.type !== "weekday").map((part) => part.value).join("");
  const weekday = today.find((part) => part.type === "weekday")?.value;
  return <div className="home">
    <header className="home-header"><Brand /><p className="date"><span>{date}</span><span>{weekday}</span></p></header>
    <section className="home-practice">
      <div className="eyebrow">TODAY’S PRACTICE</div>
      <h1>{dueCount ? <>今天有 <em>{dueCount}</em> 条<br />语言块等你复习</> : <>今天的复习<br />已经完成了</>}</h1>
      <p className="practice-copy">{dueCount ? "先想意思，再让英文自然浮现。" : "积累一点，明天继续让表达更自然。"}</p>
      {dueCount ? <>
        <div className="home-progress"><span>进度 0 / {dueCount}</span><i aria-hidden="true" /></div>
        <button className="home-cta" aria-label="开始今日复习" onClick={onReview}>开始今日复习 <AppIcon name="forward" size={22} /></button>
      </> : <button className="home-cta" aria-label="收藏新的表达" onClick={onAdd}>收藏新的表达 <AppIcon name="add" size={22} /></button>}
    </section>
    <section className="home-recent" aria-labelledby="recent-heading">
      <div className="home-section-title"><h2 id="recent-heading">最近收藏</h2><button aria-label="添加最近收藏" onClick={onAdd}><AppIcon name="bookmark" size={22} /></button></div>
      {phrases.length ? <div className="recent-list">{phrases.slice(0, 4).map((phrase) => <article className="phrase-row" key={phrase.id}><div><h3>{phrase.english}</h3><p>{phrase.chinese}</p><small>{names.get(phrase.categoryId)} · {formatDate(phrase.createdAt)}</small></div></article>)}</div> : <Empty title="从第一句话开始" detail="收藏你真正想说、将来会反复使用的英语表达。" action={<button className="secondary" onClick={onAdd}>添加第一条</button>} />}
    </section>
  </div>;
}

function AddPhrase({ categories, onSave, onCancel }: { categories: Category[]; onSave: (input: PhraseInput) => Promise<void>; onCancel: () => void }) {
  const [input, setInput] = useState<PhraseInput>({ english: "", chinese: "", categoryId: categories[0]?.id ?? "daily", personalExample: "", sourceNote: "" });
  const [errors, setErrors] = useState<PhraseErrors>({});
  const [more, setMore] = useState(false);
  const field = (key: keyof PhraseInput, value: string) => setInput((old) => ({ ...old, [key]: value }));
  const submit = async (event: React.FormEvent) => { event.preventDefault(); const next = validatePhraseInput(input); setErrors(next); if (Object.keys(next).length) return; await onSave(input); };
  return <><header className="screen-head"><button className="icon-button" onClick={onCancel} aria-label="返回"><AppIcon name="back" size={24} /></button><div><h1>收藏语言块</h1><p>Save a phrase you’ll actually use.</p></div></header>
    <form className="phrase-form" onSubmit={submit}>
      <label>英文表达<textarea autoFocus aria-label="英文表达" value={input.english} onChange={(e) => field("english", e.target.value)} placeholder="e.g. I haven't decided yet." rows={3} />{errors.english && <small className="field-error">{errors.english}</small>}</label>
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
    <div className="library-list">{filtered.map((phrase) => <article className="library-card" key={phrase.id}><div className="card-meta"><span>{names.get(phrase.categoryId)}</span><small>{masteryText[phrase.masteryLevel] ?? masteryText[0]}</small></div><h3>{phrase.english}</h3><p>{phrase.chinese}</p>{phrase.personalExample && <blockquote>{phrase.personalExample}</blockquote>}<div className="card-foot"><small>下次复习 · {formatDate(phrase.nextReviewAt)}</small><button onClick={async () => { if (confirm("确定删除这条语言块吗？")) await onDelete(phrase.id); }}>删除</button></div></article>)}</div>
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
  const addCategory = async () => { const error = validateCategoryName(name, categories.map((c) => c.name)); if (error) return setError(error); const now = new Date().toISOString(); await repository.saveCategory({ id: crypto.randomUUID(), name: name.trim(), isDefault: false, createdAt: now, updatedAt: now }); setName(""); await refresh(); setNotice("分类已添加"); };
  const exportData = async () => { const snapshot = await repository.exportSnapshot(); const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = backupFileName(); link.click(); URL.revokeObjectURL(url); setNotice("备份文件已导出"); };
  const importData = async (file?: File) => { if (!file) return; try { const backup = parseBackup(await file.text()); const policy = confirm("遇到重复记录时，用备份中的内容覆盖吗？\n选择“取消”将跳过重复项。") ? "overwrite" : "skip"; await repository.importSnapshot(backup, policy); await refresh(); setNotice("备份已成功导入"); } catch (e) { setError(e instanceof Error ? e.message : "导入失败"); } };
  return <><header className="top"><div><h1>设置</h1><p>管理你的分类与本地数据。</p></div></header>
    <section className="settings-card"><div className="section-title"><div><span>分类管理</span><small>{categories.length} 个分类</small></div></div><div className="category-list">{categories.map((c) => <div key={c.id}><span className="category-dot" /><b>{c.name}</b><small>{phrases.filter((p) => p.categoryId === c.id).length} 条</small>{!c.isDefault && <button onClick={async () => { const target = categories.find((x) => x.id !== c.id); if (!target || !confirm(`删除“${c.name}”并将内容移到“${target.name}”？`)) return; await repository.deleteCategoryAndMigrate(c.id, target.id); await refresh(); }}>删除</button>}</div>)}</div><div className="add-category"><input aria-label="新分类名称" value={name} onChange={(e) => setName(e.target.value)} placeholder="新分类名称" /><button onClick={addCategory}>添加</button></div></section>
    <section className="settings-card"><div className="section-title"><div><span>数据备份</span><small>BACKUP & RESTORE</small></div></div><div className="warning"><b>数据只保存在当前设备</b><p>更换设备、卸载浏览器或清除网站数据前，请先导出备份。</p></div><button className="settings-action" onClick={exportData}><span><AppIcon name="download" size={20} /></span><div><b>导出备份</b><small>下载完整 JSON 文件</small></div><i><AppIcon name="next" size={20} /></i></button><label className="settings-action"><span><AppIcon name="upload" size={20} /></span><div><b>导入备份</b><small>从以前的备份恢复</small></div><i><AppIcon name="next" size={20} /></i><input type="file" accept="application/json,.json" onChange={(e) => importData(e.target.files?.[0])} hidden /></label></section>
    <p className="version">Phrase Bank · 本地版 MVP</p>
  </>;
}
