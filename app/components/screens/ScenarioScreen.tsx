"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppIcon } from "../AppIcon";
import { SPEAKING_SCENARIOS, currentAttempt, findScenario, newScenarioSession, updateScenario, type ScenarioAction, type ScenarioProgress, type ScenarioSession } from "../../domain/scenarios";
import { ScenarioConflictError, ScenarioProgressStore } from "../../services/scenarioProgress";
import { TemporaryRecorder } from "../../services/recorder";
import type { PhraseRepository } from "../../storage/repository";
import type { Phrase, PhraseLearningState } from "../../domain/types";
import { matchLearnedPhrases } from "../../domain/scenarioCoaching";
import { ScenarioCoach } from "./ScenarioCoach";
import { ScenarioReviewExpression } from "./ScenarioReviewExpression";
import { screenSpeech } from "./screenSpeech";
import "./scenario.css";

export default function ScenarioScreen({ repository, username, onHome }: { repository: PhraseRepository; username?: string; onHome: () => void }) {
  const [store] = useState(() => new ScenarioProgressStore(username ?? "local", Boolean(username)));
  const [progress, setProgress] = useState<ScenarioProgress>(() => store.readLocal());
  const progressRef = useRef(progress);
  const [activeId, setActiveId] = useState<string>();
  const [filter, setFilter] = useState<"daily" | "trade">("daily");
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState("");
  const [conflict, setConflict] = useState(false);
  const [message, setMessage] = useState("");
  const [recordState, setRecordState] = useState<"idle" | "starting" | "recording" | "stopping">("idle");
  const recordStateRef = useRef(recordState);
  const [recordingUrl, setRecordingUrl] = useState<string>();
  const [recordingBlob, setRecordingBlob] = useState<Blob>();
  const [learned, setLearned] = useState<{ phrases: Phrase[]; states: PhraseLearningState[] }>({ phrases: [], states: [] });
  const [learnedStatus, setLearnedStatus] = useState<"loading" | "ready" | "error">("loading");
  const [seconds, setSeconds] = useState(0);
  const [hintOpen, setHintOpen] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [accent, setAccent] = useState<"en-US" | "en-GB">("en-US");
  const [recorder] = useState(() => new TemporaryRecorder());
  const alive = useRef(true);
  const generation = useRef(0);
  const startedAt = useRef(0);
  const activeIdRef = useRef(activeId);
  const playback = useRef<HTMLAudioElement>(null);
  const saveSequence = useRef(0);
  const current = progress.sessions.find((item) => item.id === activeId);
  const template = current && findScenario(current.scenarioId);
  const attempt = current && currentAttempt(current);
  const turn = template && current ? template.turns[current.turn] : undefined;
  const activeAudio = recordState !== "idle";
  const learnedLinks = useMemo(() => new Map(SPEAKING_SCENARIOS.map((s) => [s.id, matchLearnedPhrases(s, learned.phrases, learned.states)])), [learned]);
  const linkedCount = (id: string) => new Set(learnedLinks.get(id)?.flat().map((p) => p.id)).size;
  const linked = current ? learnedLinks.get(current.scenarioId)?.[current.turn] ?? [] : [];
  const previousAttempt = current?.attempts.filter((a) => a.turn === current.turn && a.id !== attempt?.id && a.transcript).at(-1);
  const retryAllowed = Boolean(current && current.attempts.length < 18);

  const showSyncError = useCallback((error: unknown) => {
    if (!alive.current) return;
    setConflict(error instanceof ScenarioConflictError);
    setSyncStatus(error instanceof ScenarioConflictError ? error.message : store.localSaved ? "本机草稿已保存，云端未同步。" : "尚未保存，请保持页面打开并重试。");
  }, [store]);
  const loadLearned = useCallback(() => {
    void Promise.all([repository.listPhrases(), repository.listPhraseLearningStates()]).then(([phrases, states]) => { if (alive.current) { setLearned({ phrases, states }); setLearnedStatus("ready"); } }).catch(() => { if (alive.current) setLearnedStatus("error"); });
  }, [repository]);
  useEffect(() => {
    alive.current = true;
    void store.load().then((value) => { if (alive.current) { progressRef.current = value; setProgress(value); setSyncStatus(username ? "进度已同步" : "进度保存在本机"); } }).catch(showSyncError).finally(() => { if (alive.current) setLoading(false); });
    void repository.getSpeechPreferences().then((value) => { if (alive.current) setAccent(value.accent); }).catch(() => undefined);
    loadLearned();
    return () => { alive.current = false; generation.current += 1; recorder.dispose(); screenSpeech.cancel(); };
  }, [recorder, repository, showSyncError, store, username, loadLearned]);

  const commit = (session: ScenarioSession) => {
    const exists = progressRef.current.sessions.some((item) => item.id === session.id);
    const sessions = exists ? progressRef.current.sessions.map((item) => item.id === session.id ? session : item) : [session, ...progressRef.current.sessions];
    // Keep all unfinished sessions; trim only completed history.
    const value = { sessions: [...sessions.filter((s) => !s.completedAt), ...sessions.filter((s) => s.completedAt)].slice(0, 30) };
    progressRef.current = value; setProgress(value);
    const sequence = ++saveSequence.current;
    const saving = store.save(value);
    setSyncStatus(username ? "正在同步…" : store.localSaved ? "进度保存在本机" : "尚未保存，请保持页面打开");
    void saving.then(() => { if (alive.current && sequence === saveSequence.current) { setConflict(false); setSyncStatus(username ? "进度已同步" : "进度保存在本机"); } }).catch((error) => { if (sequence === saveSequence.current) showSyncError(error); });
  };
  const act = (action: ScenarioAction) => {
    const session = progressRef.current.sessions.find((s) => s.id === activeIdRef.current);
    if (!session) return;
    const next = updateScenario(session, action);
    if (next !== session) commit(next);
  };
  const transitionRecording = (state: typeof recordState) => { recordStateRef.current = state; setRecordState(state); };
  const stopMedia = () => {
    generation.current += 1; recorder.dispose(); screenSpeech.cancel(); playback.current?.pause();
    transitionRecording("idle"); setSpeaking(false); setRecordingUrl(undefined); setRecordingBlob(undefined); setSeconds(0);
  };
  const openSession = (session: ScenarioSession) => {
    stopMedia(); setMessage(""); setHintOpen(false); activeIdRef.current = session.id; setActiveId(session.id); window.scrollTo(0, 0);
  };
  const startScenario = (id: string, forceNew = false) => {
    const previous = progressRef.current.sessions.find((s) => s.scenarioId === id && !s.completedAt);
    if (previous && !forceNew) return openSession(previous);
    if (progressRef.current.sessions.filter((s) => !s.completedAt).length >= 20) { setMessage("请先完成一个进行中的场景，再开启新练习。"); return; }
    const session = newScenarioSession(id); commit(session); openSession(session);
  };
  const backToList = () => { stopMedia(); activeIdRef.current = undefined; setActiveId(undefined); setMessage(""); loadLearned(); };
  const speak = (text: string, hint = false) => {
    if (recordStateRef.current !== "idle") return;
    if (hint) act({ type: "hint" });
    playback.current?.pause(); setMessage(""); setSpeaking(true);
    const run = ++generation.current;
    void screenSpeech.speak(text, accent).catch((error: unknown) => { if (alive.current && generation.current === run) setMessage(error instanceof Error ? error.message : "发音暂时无法播放，请重试。"); }).finally(() => { if (alive.current && generation.current === run) setSpeaking(false); });
  };
  const stopRecording = async () => {
    if (recordStateRef.current !== "recording") return;
    transitionRecording("stopping");
    const run = generation.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([recorder.stop(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("录音未能结束，请重新尝试。")), 5000); })]);
      if (!alive.current || run !== generation.current) return;
      if (!result.blob.size) throw new Error("没有收到录音，请重新尝试或选择直接说。");
      setRecordingUrl(result.url); setRecordingBlob(result.blob); act({ type: "practice", recorded: true });
    } catch (error) { if (alive.current && run === generation.current) { recorder.dispose(); setMessage(error instanceof Error ? error.message : "录音失败，请直接练习。"); } }
    finally { clearTimeout(timer); if (alive.current && run === generation.current) transitionRecording("idle"); }
  };
  const stopRef = useRef(stopRecording);
  useEffect(() => { stopRef.current = stopRecording; });
  useEffect(() => {
    if (recordState !== "recording") return;
    const timer = setInterval(() => { const elapsed = Math.floor((Date.now() - startedAt.current) / 1000); setSeconds(elapsed); if (elapsed >= 90) void stopRef.current(); }, 250);
    const pause = () => { if (document.visibilityState === "hidden") void stopRef.current(); };
    document.addEventListener("visibilitychange", pause);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", pause); };
  }, [recordState]);
  const startRecording = async () => {
    if (recordStateRef.current !== "idle") return;
    screenSpeech.cancel(); playback.current?.pause(); setSpeaking(false); setRecordingUrl(undefined); setRecordingBlob(undefined); setMessage("");
    transitionRecording("starting");
    const run = ++generation.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([recorder.start(), new Promise<never>((_, reject) => { timer = setTimeout(() => { recorder.dispose(); reject(new Error("麦克风未能开启，可以取消后直接说。")); }, 10_000); })]);
      if (!alive.current || run !== generation.current) return;
      startedAt.current = Date.now(); setSeconds(0); transitionRecording("recording");
    } catch { if (alive.current && run === generation.current) { transitionRecording("idle"); setMessage("麦克风暂不可用。请检查权限，或选择“不录音，直接说”。"); } }
    finally { clearTimeout(timer); }
  };
  const retrySync = () => { setSyncStatus("正在同步…"); void store.sync().then(() => { if (alive.current) setSyncStatus(username ? "进度已同步" : "进度保存在本机"); }).catch(showSyncError); };
  const loadCloud = () => {
    if (!confirm("本机草稿会另存一份，然后读取另一台设备的进度。继续吗？")) return;
    stopMedia(); setLoading(true);
    void store.load(true).then((value) => { if (alive.current) { progressRef.current = value; setProgress(value); setConflict(false); setSyncStatus("已读取云端进度"); activeIdRef.current = undefined; setActiveId(undefined); } }).catch(showSyncError).finally(() => { if (alive.current) setLoading(false); });
  };
  const exportProgress = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ format: "phrase-bank-scenarios", version: 1, ...progressRef.current }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "phrase-bank-scenarios.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const syncNotice = <div className={`scenario-sync${conflict ? " is-error" : ""}`} role="status"><span>{syncStatus}</span>{/未同步|尚未保存/.test(syncStatus) && <button onClick={retrySync}>重试同步</button>}{conflict && <><button onClick={exportProgress}>导出本机草稿</button><button onClick={loadCloud}>读取云端进度</button></>}</div>;
  const retry = () => { if (!retryAllowed) return; stopMedia(); act({ type: "retry" }); setHintOpen(false); setMessage(""); window.scrollTo(0, 0); };

  if (!current || !template || !turn || !attempt) return <section className="scenario-screen scenario-library">
    <header className="scenario-top"><button aria-label="返回首页" onClick={onHome}><AppIcon name="back" size={22} /></button><strong>场景口语</strong><span>开口练一会儿</span></header>
    <div className="scenario-library-body"><p className="scenario-eyebrow">REAL-LIFE CONVERSATIONS</p><h1>把英语用起来</h1><p className="scenario-intro">一句接一句，练你真正会遇到的对话。<br />每个场景 3 轮，约 5–8 分钟。</p>
      <p className="scenario-muted">用自己的话回应，不用背标准答案。优先推荐能复用已学表达的场景；对方台词仍为预设内容。</p>
      {learnedStatus !== "ready" && <p className="scenario-muted">{learnedStatus === "loading" ? "正在匹配已学表达…" : "暂未读到已学记录，仍可做通用练习。"}</p>}
      {loading && <p role="status">正在读取练习进度…</p>}
      {progress.sessions.some((s) => !s.completedAt) && <div className="scenario-resume"><h2>接着上次练</h2>{progress.sessions.filter((s) => !s.completedAt).map((s) => <button key={s.id} disabled={loading} onClick={() => openSession(s)}><span>{findScenario(s.scenarioId)?.title}<small>第 {s.turn + 1} / 3 轮</small></span><AppIcon name="forward" /></button>)}</div>}
      <div className="scenario-filters" aria-label="场景类型"><button aria-pressed={filter === "daily"} onClick={() => setFilter("daily")}>日常交流 <span>8</span></button><button aria-pressed={filter === "trade"} onClick={() => setFilter("trade")}>外贸沟通 <span>4</span></button></div>
      <div className="scenario-list">{SPEAKING_SCENARIOS.filter((s) => s.category === filter).sort((a, b) => linkedCount(b.id) - linkedCount(a.id)).map((s) => <button key={s.id} disabled={loading} onClick={() => startScenario(s.id)}><span><b>{s.title}</b><small>{s.goal}</small>{learnedStatus === "ready" && <small className={linkedCount(s.id) ? "scenario-learned-tag" : ""}>{linkedCount(s.id) ? `可复用 ${linkedCount(s.id)} 条已学表达` : "通用练习 · 暂无匹配的已学表达"}</small>}{progress.sessions.some((session) => session.scenarioId === s.id && session.focusedTurns.length > 0) && <em>有表达想再练</em>}</span><AppIcon name="forward" size={20} /></button>)}</div>
      {filter === "trade" && <p className="scenario-footnote">你是中国供货方，与海外客户沟通。示例业务条件请按实际情况调整。</p>}
      {progress.sessions.some((s) => s.completedAt) && <details className="scenario-history"><summary>最近完成的练习</summary>{progress.sessions.filter((s) => s.completedAt).slice(0, 10).map((s) => <button className="scenario-text-button" key={s.id} onClick={() => openSession(s)}>{findScenario(s.scenarioId)?.title} · {new Date(s.completedAt!).toLocaleDateString("zh-CN")}</button>)}</details>}
      {message && <p role="alert" className="scenario-message">{message}</p>}{syncNotice}
      <button className="scenario-export" onClick={exportProgress}>导出场景练习记录</button>
    </div></section>;

  if (current.completedAt) return <section className="scenario-screen scenario-summary">
    <header className="scenario-top"><button aria-label="返回场景列表" onClick={backToList}><AppIcon name="back" size={22} /></button><strong>场景口语</strong></header>
    <div className="scenario-summary-body"><AppIcon name="completion" size={44} /><p className="scenario-eyebrow">CONVERSATION COMPLETE</p><h1>这段对话，练完了</h1><p>{template.title} · 已完成 3 轮回应</p>
      <div className="scenario-results">{template.turns.map((item, index) => { const last = current.attempts.filter((a) => a.turn === index).at(-1)!; return <div key={item.question}><span>第 {index + 1} 轮</span><b>{last.rating === "independent" ? "自评：独立说清楚" : last.rating === "partial" ? "还需要练一练" : "需要再熟悉"}</b><small>{last.usedHint ? "用过提示" : "未看提示"} · {last.recorded ? "录音练习" : "无录音练习"}</small></div>; })}</div>
      {current.attempts.some((a) => a.transcript) && <details className="scenario-history"><summary>查看我的回答与建议</summary>{current.attempts.filter((a) => a.transcript).map((a, index) => <article key={a.id}><h3>第 {a.turn + 1} 轮 · 记录 {index + 1}</h3><p lang="en">{a.transcript}</p>{a.feedback && <><p>{a.feedback.summary}</p><p lang="en">{a.feedback.improvedAnswer}</p><p>{a.feedback.translation}</p><small>{a.feedback.comparison ?? a.feedback.retryFocus}</small></>}</article>)}</details>}
      <h2>下次，重点练哪几句？</h2><p className="scenario-muted">勾选只是做个标记；理解并开口练过后，可单独加入日常复习。</p>
      <div className="scenario-focus">{template.turns.map((item, index) => <label key={item.answer}><input type="checkbox" checked={current.focusedTurns.includes(index)} onChange={() => act({ type: "focus", turn: index })} /><span>{item.answer}<small>{item.answerTranslation}</small></span></label>)}</div>
      {current.focusedTurns.map((index) => <section className="scenario-summary-review" key={`${current.id}:${index}`}><h3>第 {index + 1} 轮 · 加入复习</h3><ScenarioReviewExpression input={{ english: template.turns[index].answer, chinese: template.turns[index].answerTranslation, sourceNote: `场景口语：${template.title} · 第 ${index + 1} 轮参考表达` }} repository={repository} /></section>)}
      {syncNotice}<div className="scenario-summary-actions"><button className="scenario-primary" onClick={() => startScenario(template.id, true)}>再练一次</button><button className="scenario-secondary" onClick={backToList}>换个场景</button><button className="scenario-text-button" onClick={onHome}>回到首页</button></div>
    </div></section>;

  return <section className="scenario-screen scenario-dialogue">
    <header className="scenario-top"><button aria-label="暂停并返回场景列表" onClick={backToList}><AppIcon name="back" size={22} /></button><strong>场景口语</strong><span>随时可暂停</span></header>
    <div className="scenario-dialogue-body">
      <h1>{template.title}</h1><p className="scenario-round"><span>情景练习</span> · 第 {current.turn + 1} / {template.turns.length} 轮</p>
      {linked.length > 0 && <p className="scenario-learned-tag">这轮有 {linked.length} 条已学表达可用，先试着自己想起来。</p>}
      <section className="scenario-question" aria-label="对方的问题"><p className="scenario-role">{template.partner}</p><div className="scenario-question-row"><span className="scenario-avatar" aria-hidden="true">{template.category === "trade" ? "B" : "P"}</span><div className="scenario-question-bubble"><p lang="en">{turn.question}</p><p className="scenario-translation">{turn.translation}</p><button disabled={activeAudio} onClick={() => speak(turn.question)}><AppIcon name="speaker" size={21} />{speaking ? "正在播放…" : "听对方的问题"}</button></div></div></section>
      <section className="scenario-response" aria-label="你的回应"><p className="scenario-role">{template.role}</p><div className="scenario-response-surface"><h2>轮到你回应</h2><p>{turn.task}</p><p className="scenario-keywords">{turn.keywords.join(" · ")}</p><button className="scenario-hint-toggle" disabled={activeAudio} aria-expanded={hintOpen} onClick={() => { if (!hintOpen) act({ type: "hint" }); setHintOpen(!hintOpen); }}><AppIcon name="library" size={20} /><span>{hintOpen ? "收起参考表达" : "需要帮助？展开参考表达"}</span><AppIcon name="next" size={18} /></button>
        {hintOpen && <div className="scenario-hint">{linked.length > 0 && <div className="scenario-learned-expressions"><b>你学过的表达，可按情境改一改</b>{linked.map((phrase) => <div key={phrase.id}><p lang="en">{phrase.english}</p><p>{phrase.chinese}</p><button disabled={activeAudio} onClick={() => speak(phrase.english, true)}>听这条已学表达</button></div>)}</div>}<b>一种参考回答</b><p lang="en">{turn.answer}</p><p>{turn.answerTranslation}</p><button disabled={activeAudio} onClick={() => speak(turn.answer, true)}><AppIcon name="speaker" size={19} />听参考回答</button><small>参考是一种说法，不必逐字背诵。</small></div>}
      </div></section>
      {message && <p role="alert" className="scenario-message">{message}</p>}
      {attempt.practiced && <div className="scenario-reflect">{recordingUrl && <audio ref={playback} aria-label="回听我的回答" controls src={recordingUrl} onPlay={() => screenSpeech.cancel()}><track kind="captions" /></audio>}
        <ScenarioCoach key={attempt.id} attempt={attempt} previousTranscript={previousAttempt?.transcript} scenarioId={template.id} title={template.title} blob={recordingBlob} repository={repository} onAction={act} onRetry={retry} retryAllowed={retryAllowed} onSpeak={(text) => speak(text, true)} />
        <h2>这次，你说得怎么样？</h2><div className="scenario-ratings">{([ ["again", "还说不出来"], ["partial", "能说一些，还会卡"], ["independent", "能独立说清楚"] ] as const).map(([value, label]) => <button key={value} disabled={activeAudio || (value === "independent" && attempt.usedHint)} aria-pressed={attempt.rating === value} onClick={() => act({ type: "rate", rating: value })}>{label}</button>)}</div>{attempt.usedHint && <p className="scenario-muted">本次用过提示，不能记为独立完成。重新挑战可再试。</p>}<button className="scenario-text-button" disabled={activeAudio || !retryAllowed} onClick={retry}>重新挑战</button>{!retryAllowed && <p className="scenario-muted">本次重试次数已达上限。可自评继续，完成后再练一个新场景。</p>}</div>}
    </div>
    <div className="scenario-actions">
      {!attempt.practiced && <><AppIcon name="microphone" size={30} /><p>{recordState === "recording" ? `正在录音 ${seconds} 秒 · 最长 90 秒` : recordState === "starting" ? "正在开启麦克风…" : "用自己的话回答，30 秒左右"}</p></>}
      {recordState === "starting" ? <button className="scenario-secondary" onClick={() => { stopMedia(); setMessage("已取消，可以不录音直接练习。"); }}>取消开启麦克风</button> : recordState === "recording" ? <button className="scenario-primary is-recording" onClick={() => void stopRecording()}><AppIcon name="stop" size={22} />停止录音</button> : recordState === "stopping" ? <button className="scenario-primary" disabled>正在结束录音…</button> : attempt.practiced ? <button className="scenario-primary" disabled={!attempt.rating} onClick={() => { stopMedia(); act({ type: "next" }); setHintOpen(false); setMessage(""); window.scrollTo(0, 0); }}>{current.turn === template.turns.length - 1 ? "完成这段对话" : "下一轮对话"}<AppIcon name="forward" size={20} /></button> : <><button className="scenario-primary" onClick={() => void startRecording()}><AppIcon name="microphone" size={23} />录下我的回答</button><button className="scenario-secondary" onClick={() => { screenSpeech.cancel(); setSpeaking(false); act({ type: "practice", recorded: false }); }}>不录音，直接说</button></>}
      <p className="scenario-footnote">{attempt.practiced ? "请根据自己实际开口的情况自评" : "录音默认仅供回听；主动点击转写后才会上传"}</p>{syncNotice}
    </div>
  </section>;
}
