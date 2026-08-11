"use client";
import { useMemo, useState } from "react";
import { AppIcon } from "../AppIcon";
import type { Category, LearningStage, Phrase, PhraseLearningState } from "../../domain/types";
const masteryText = ["未掌握", "有印象", "可以使用", "已自动化"];
const formatDate = (iso: string) => new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(iso));
function Empty({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) {
  return <div className="empty"><div className="empty-glyph"><AppIcon name="bookmark" size={42} /></div><h3>{title}</h3><p>{detail}</p>{action}</div>;
}

export default function Library({ phrases, categories, learningStates, onDelete, onCopy, onAdd }: { phrases: Phrase[]; categories: Category[]; learningStates: PhraseLearningState[]; onDelete: (id: string) => Promise<void>; onCopy: (phrase: Phrase) => Promise<void>; onAdd: () => void }) {
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
