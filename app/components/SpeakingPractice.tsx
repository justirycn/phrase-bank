"use client";

import { useRef, useState } from "react";
import type { ReviewResult } from "../domain/types";
import type { TrainingSessionController } from "../hooks/useTrainingSession";
import { AppIcon } from "./AppIcon";

export function SpeakingPractice({ controller, onHome, onAgain }: {
  controller: TrainingSessionController;
  onHome: () => void;
  onAgain: () => void;
}) {
  const [status, setStatus] = useState("");
  const [microphoneFailed, setMicrophoneFailed] = useState(false);
  const recordingStart = useRef<Promise<void>>();
  const recordingStarted = useRef(false);
  const pointerGesture = useRef(false);
  const keyboardGesture = useRef(false);
  const suppressNextClick = useRef(false);
  const run = async (action: () => Promise<unknown>) => {
    setStatus("");
    try { await action(); } catch { setStatus("操作没有完成，你仍然可以继续练习。再试一次即可。"); }
  };
  const grade = (result: ReviewResult) => run(() => controller.grade(result));
  const beginRecording = () => {
    setMicrophoneFailed(false); setStatus("");
    recordingStarted.current = false;
    const pending = Promise.resolve(controller.startRecording()).then(() => { recordingStarted.current = true; }).catch(() => {
      setMicrophoneFailed(true);
      setStatus("没有获得麦克风权限。你可以在浏览器设置中允许访问，或跳过录音继续练习。");
    });
    recordingStart.current = pending;
    return pending;
  };
  const endRecording = async () => {
    if (!recordingStart.current && controller.phase === "recording") {
      await controller.stopRecording();
      return;
    }
    try { await recordingStart.current; if (recordingStarted.current) await controller.stopRecording(); } catch { /* Guidance is already visible. */ }
    finally { recordingStart.current = undefined; }
  };

  if (controller.initializationError) return <section className="practice-error" role="alert"><AppIcon name="completion" size={34} /><h1>训练暂时打不开</h1><p>{controller.initializationError}</p><div className="practice-complete-actions"><button className="secondary" onClick={onHome}>返回首页</button><button className="primary" onClick={onAgain}>重试</button></div></section>;

  if (controller.phase === "complete") return <section className="practice-complete">
    <div className="done-mark"><AppIcon name="completion" size={36} /></div>
    <p className="eyebrow">GROUP COMPLETE</p><h1>这一组完成了</h1>
    <p>你完成了 {controller.total} 个语言块。零碎时间，也在积累真正能说出口的英语。</p>
    <p className="practice-duration"><AppIcon name="clock" size={18} />本组有效练习 {Math.floor(controller.activeSeconds / 60)} 分钟</p>
    <div className="practice-complete-actions"><button className="secondary" onClick={onHome}>回到首页</button><button className="primary" onClick={onAgain}>再练一组</button></div>
  </section>;

  const phrase = controller.current?.phrase;
  if (!phrase) return <section className="practice-loading" aria-live="polite">正在准备今天的语言块…</section>;
  const answered = controller.phase === "answer";
  const recording = controller.phase === "recording";
  return <section className={`speaking-practice phase-${controller.phase} ${recording ? "is-recording" : ""} ${microphoneFailed ? "has-microphone-fallback" : ""}`}>
    <header className="practice-head"><span><AppIcon name="clock" size={18} /> 第 {controller.index + 1} / {controller.total} 个</span><div className="practice-track"><i style={{ width: `${((controller.index + (answered ? .6 : 0)) / Math.max(1, controller.total)) * 100}%` }} /></div></header>
    <div className="practice-prompt"><p className="eyebrow">先用英语表达</p><h1>{phrase.chinese}</h1>
      {!answered && controller.phase !== "recording" && <p>不用逐字翻译，先说出你自然想到的表达。</p>}
      {controller.phase === "recording" && <p className="recording-status" role="status"><span />正在听你说…</p>}
      {answered && <div className="practice-answer"><p className="eyebrow">自然表达</p><h2>{phrase.english}</h2>{phrase.personalExample && <blockquote>{phrase.personalExample}</blockquote>}</div>}
    </div>
    {status && <p className="practice-status" role="status">{status}</p>}
    <div className="practice-actions">
      {(controller.phase === "prompt" || recording) && <button className={`record-action ${recording ? "recording" : ""}`} onPointerDown={() => { pointerGesture.current = true; if (!recording) void beginRecording(); }} onPointerUp={() => void endRecording()} onPointerCancel={() => { pointerGesture.current = false; void endRecording(); }} onKeyDown={(event) => { if (!event.repeat && !recording && (event.key === " " || event.key === "Enter")) { event.preventDefault(); keyboardGesture.current = true; void beginRecording(); } }} onKeyUp={(event) => { if (keyboardGesture.current && (event.key === " " || event.key === "Enter")) { event.preventDefault(); keyboardGesture.current = false; suppressNextClick.current = true; void endRecording(); } }} onClick={() => { if (pointerGesture.current) { pointerGesture.current = false; return; } if (suppressNextClick.current) { suppressNextClick.current = false; return; } if (recording) void endRecording(); else void beginRecording(); }}>{recording ? <AppIcon name="stop" size={24} /> : <AppIcon name="microphone" size={24} />}{recording ? "我说完了" : "按住说英语"}</button>}
      {controller.phase === "prompt" && <>
        <button className="unknown-action" onClick={() => run(controller.revealAsUnknown)}>不会，直接看答案</button>
        <button className="pronounce-action" onClick={() => run(controller.usePronunciationHint)}><AppIcon name="speaker" size={21} />先听发音</button>
        {microphoneFailed && <button className="skip-recording" onClick={() => run(controller.revealForSelfAssessment)}>跳过录音，继续自评</button>}
      </>}
      {answered && <>
        {/* This is the learner's just-recorded speech; a caption track does not exist. */}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        {controller.recordingUrl && <audio aria-label="播放我的录音" controls src={controller.recordingUrl} />}
        <div className="answer-tools"><button onClick={() => run(controller.repeatPronunciation)}><AppIcon name="speaker" size={20} />再听标准发音</button><button onClick={() => run(controller.repeatPronunciation)}><AppIcon name="repeat" size={20} />跟读一次</button></div>
        <div className="practice-grades"><button onClick={() => grade("again")}>不会</button><button onClick={() => grade("hard")}>模糊</button><button disabled={controller.usedHint} title={controller.usedHint ? "听过提示后，本次最高记为模糊" : undefined} onClick={() => grade("good")}>掌握</button></div>
      </>}
    </div>
  </section>;
}
