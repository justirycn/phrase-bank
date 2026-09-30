import { useEffect, useRef, useState } from "react";
import type { ScenarioAction, SpeakingAttempt } from "../../domain/scenarios";
import type { PhraseRepository } from "../../storage/repository";
import { requestScenarioFeedback, transcribeRecording } from "../../services/scenarioCoach";
import { ScenarioReviewExpression } from "./ScenarioReviewExpression";

export function ScenarioCoach({ attempt, previousTranscript, scenarioId, title, blob, repository, onAction, onRetry, retryAllowed, onSpeak }: {
  attempt: SpeakingAttempt; previousTranscript?: string; scenarioId: string; title: string; blob?: Blob; repository: PhraseRepository;
  onAction: (action: ScenarioAction) => void; onRetry: () => void; retryAllowed: boolean; onSpeak: (text: string) => void;
}) {
  const [text, setText] = useState(attempt.transcript ?? "");
  const [busy, setBusy] = useState<"transcribing" | "coaching">();
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const request = useRef<AbortController | undefined>(undefined);
  const feedback = text.trim() === attempt.transcript ? attempt.feedback : undefined;
  useEffect(() => () => { request.current?.abort(); request.current = undefined; }, []);
  const cancel = () => { request.current?.abort(); request.current = undefined; setBusy(undefined); setNotice("已取消；可以手动填写或直接自评。"); };
  const run = async (kind: "transcribing" | "coaching") => {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller; setBusy(kind); setError(""); setNotice("");
    try {
      if (kind === "transcribing" && blob) {
        const result = await transcribeRecording(blob, controller.signal);
        if (!controller.signal.aborted) { setText(result); setNotice("请先核对文字；识别错的地方可以直接修改。"); }
      } else {
        const transcript = text.trim(); onAction({ type: "transcript", text: transcript });
        const result = await requestScenarioFeedback({ scenarioId, turn: attempt.turn, transcript, previousTranscript }, controller.signal);
        if (!controller.signal.aborted) onAction({ type: "feedback", text: transcript, feedback: result });
      }
    } catch (problem) {
      if (!controller.signal.aborted) setError(problem instanceof Error && !["TimeoutError", "AbortError", "EncodingError"].includes(problem.name) ? problem.message : "处理超时或录音格式不兼容，可以重试、手动填写或直接自评。");
    } finally { if (request.current === controller) { request.current = undefined; setBusy(undefined); } }
  };
  return <section className="scenario-coach" aria-label="回答反馈">
    <h2>把这次回答练得更顺</h2>
    <p className="scenario-muted">可选：确认回答文字，再看表达建议。也可以跳过，直接自评继续。</p>
    {blob && !feedback && <><button className="scenario-secondary" disabled={Boolean(busy)} onClick={() => void run("transcribing")}>{busy === "transcribing" ? "正在识别你的回答…" : "上传录音并转写"}</button><p className="scenario-muted">点击后会把本次录音发送给 Qwen 转写；本应用不保存原始录音。离开本轮后无法再回听。</p></>}
    {!blob && attempt.recorded && <p className="scenario-muted">本次录音已释放，已确认的文字仍保留。可以手动填写，或重新挑战再录。</p>}
    <label className="scenario-transcript-label">我刚才的回答（可修改）<textarea aria-label="我刚才的回答" lang="en" value={text} maxLength={1800} rows={4} disabled={Boolean(busy)} placeholder="填写你刚才实际说的话，中英文夹杂也可以。不是填写参考答案。" onChange={(event) => { setText(event.target.value); setNotice(""); setError(""); }} /></label>
    <p className="scenario-muted">确认后，文字将发送给 Qwen 获取建议，并随练习记录同步到你的账号；AI 仅分析文字，不评判发音。</p>
    {!feedback && <button className="scenario-primary" disabled={Boolean(busy) || !text.trim()} onClick={() => void run("coaching")}>{busy === "coaching" ? "正在整理表达建议…" : "确认文字，获取建议"}</button>}
    {busy && <button className="scenario-text-button" onClick={cancel}>取消等待</button>}
    {notice && <p className="scenario-muted" role="status">{notice}</p>}{error && <p className="scenario-message" role="alert">{error}</p>}
    {feedback && <div className="scenario-feedback">
      <p className="scenario-feedback-label">{({ answered: "回应到了问题", partial: "还可以补充一点", "off-topic": "先回到对方的问题" })[feedback.taskCheck]} · AI 文字建议</p>
      <h3>{feedback.summary}</h3><p>{feedback.positive}</p>
      {feedback.improvements.map((item, i) => <div className="scenario-correction" key={i}><b>{item.issue}</b><p lang="en">{item.suggestion}</p><small>{item.reason}</small></div>)}
      <h3>保留你的意思，可以这样说</h3><p className="scenario-better-answer" lang="en">{feedback.improvedAnswer}</p><p>{feedback.translation}</p>
      <button className="scenario-text-button" onClick={() => onSpeak(feedback.improvedAnswer)}>听这句表达</button>
      {feedback.comparison && <p className="scenario-comparison"><b>和上一次相比：</b>{feedback.comparison}</p>}
      <p><b>再试一次：</b>{feedback.retryFocus}</p>
      <button className="scenario-primary" disabled={!retryAllowed} onClick={onRetry}>按建议再说一次</button>
      <p className="scenario-muted">建议不一定完全准确，尤其是业务条件，请核对后再使用。查看建议算用过提示，重新挑战后再自评。</p>
      <ScenarioReviewExpression key={feedback.improvedAnswer} input={{ english: feedback.improvedAnswer, chinese: feedback.translation, sourceNote: `场景口语：${title} · 第 ${attempt.turn + 1} 轮（AI 建议，经用户确认练过）` }} repository={repository} />
    </div>}
  </section>;
}
