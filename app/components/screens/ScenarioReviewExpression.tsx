import { useEffect, useRef, useState } from "react";
import type { ScenarioReviewInput } from "../../domain/scenarioCoaching";
import type { PhraseRepository } from "../../storage/repository";

export function ScenarioReviewExpression({ input, repository }: { input: ScenarioReviewInput; repository: PhraseRepository }) {
  const [understood, setUnderstood] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState(""); const alive = useRef(true); const pending = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const add = async () => {
    if (!understood || pending.current || status === "saved") return;
    pending.current = true; setStatus("saving"); setError("");
    try { await repository.addScenarioReview(input); if (alive.current) setStatus("saved"); }
    catch { if (alive.current) { setStatus("idle"); setError("还没有加入成功，请重试。原有掌握进度未改变。"); } }
    finally { pending.current = false; }
  };
  return <div className="scenario-review-add">
    {status !== "saved" && <label><input type="checkbox" checked={understood} disabled={status === "saving"} onChange={(event) => setUnderstood(event.target.checked)} />我已理解并开口练过这句</label>}
    <button className="scenario-secondary" disabled={!understood || status !== "idle"} onClick={() => void add()}>{status === "saving" ? "正在加入复习…" : status === "saved" ? "已加入待复习" : "加入我的复习"}</button>
    <p className="scenario-muted">已有句子会提前到待复习；新表达存入个人句库，不增加掌握度。</p>
    {error && <p role="alert" className="scenario-message">{error}</p>}
  </div>;
}
