"use client";
import { useState } from "react";
import { AppIcon } from "../AppIcon";
import type { Phrase, ReviewResult } from "../../domain/types";

export default function Review({ phrases, onBack, onGrade }: { phrases: Phrase[]; onBack: () => void; onGrade: (id: string, result: ReviewResult) => Promise<void> }) {
  const [index, setIndex] = useState(0); const [revealed, setRevealed] = useState(false); const [counts, setCounts] = useState({ again: 0, hard: 0, good: 0 });
  const phrase = phrases[index];
  const grade = async (result: ReviewResult) => { if (!phrase) return; await onGrade(phrase.id, result); setCounts((old) => ({ ...old, [result]: old[result] + 1 })); setIndex((i) => i + 1); setRevealed(false); };
  if (!phrase) return <div className="review-done"><div className="done-mark"><AppIcon name="completion" size={36} /></div><h1>今天完成了</h1><p>复习了 {index} 条语言块。主动回忆一次，就离自然表达更近一点。</p><div className="summary"><span>不会 <b>{counts.again}</b></span><span>模糊 <b>{counts.hard}</b></span><span>掌握 <b>{counts.good}</b></span></div><button className="primary" onClick={onBack}>回到首页</button></div>;
  return <div className="review-screen"><header><button className="icon-button" onClick={onBack} aria-label="退出复习"><AppIcon name="close" size={24} /></button><div className="progress"><span style={{ width: `${((index + (revealed ? .5 : 0)) / phrases.length) * 100}%` }} /></div><small>{index + 1} / {phrases.length}</small></header><div className="review-card"><small>中文提示</small><h1>{phrase.chinese}</h1>{revealed ? <div className="answer"><i /><small>自然表达</small><h2>{phrase.english}</h2>{phrase.personalExample && <p>{phrase.personalExample}</p>}</div> : <><p>先在心里或开口说出英文</p><button className="reveal" onClick={() => setRevealed(true)} aria-label="显示英文答案">显示英文答案</button></>}</div>{revealed && <div className="grade-row"><button className="again" onClick={() => grade("again")}><b>不会</b><small>10 分钟后</small></button><button className="hard" onClick={() => grade("hard")}><b>模糊</b><small>明天再见</small></button><button className="good" onClick={() => grade("good")}><b>掌握</b><small>延长间隔</small></button></div>}</div>;
}
