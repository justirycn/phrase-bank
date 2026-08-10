"use client";

import { useRef, useState } from "react";
import type { ReviewResult } from "../domain/types";
import type { NewPhraseLearningController } from "../hooks/useNewPhraseLearning";
import { AppIcon } from "./AppIcon";

export function NewPhraseLearning({ controller, onHome }: {
  controller: NewPhraseLearningController;
  onHome: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const pendingRef = useRef(false);

  const run = async (action: () => Promise<unknown> | void) => {
    if (pendingRef.current || controller.busy) return;
    pendingRef.current = true;
    setPending(true);
    setStatus("");
    try {
      await action();
    } catch {
      setStatus("操作没有完成，你仍然可以继续学习。请再试一次。");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  const disabled = controller.busy || pending;
  const exit = () => { void run(onHome); };

  if (controller.phase === "loading") {
    return <section className="new-learning-loading" aria-live="polite">正在准备今天的新语言块</section>;
  }

  if (controller.phase === "error") {
    return <section className="new-learning-error" role="alert">
      <AppIcon name="completion" size={34} />
      <h1>学习内容暂时打不开</h1>
      <p>{controller.error ?? "暂时无法加载，请稍后重试。"}</p>
      <div className="new-learning-state-actions">
        <button type="button" onClick={exit}>返回首页</button>
        <button type="button" disabled={disabled} onClick={() => { void run(controller.retry); }}>重试</button>
      </div>
    </section>;
  }

  if (controller.phase === "empty") {
    return <section className="new-learning-empty">
      <h1>今天没有新的语言块需要学习</h1>
      <p>你已经学完目前可用的新内容，可以先复习已学语言块。</p>
      <button type="button" onClick={exit}>返回首页</button>
    </section>;
  }

  if (controller.phase === "complete") {
    return <section className="new-learning-complete">
      <AppIcon name="completion" size={36} />
      <h1>本组学习完成</h1>
      <p>本组已学习 {controller.total} 个语言块</p>
      <button type="button" onClick={exit}>返回首页</button>
    </section>;
  }

  const current = controller.current;
  if (!current) {
    return <section className="new-learning-loading" aria-live="polite">正在准备今天的新语言块</section>;
  }

  const isStudy = controller.phase === "study";
  const showAnswer = isStudy || controller.revealed;
  const index = isStudy ? controller.studyIndex : controller.testIndex;
  const showContext = showAnswer && Boolean(current.intent || current.sourceNote);
  const showExamples = isStudy && current.origin === "system" && current.kind === "core";
  const progress = `${index + 1} / ${controller.total}`;
  const grade = (result: ReviewResult) => { void run(() => controller.grade(result)); };

  return <section className={`new-phrase-learning phase-${controller.phase}`}>
    <header className="new-learning-head">
      <button type="button" className="new-learning-close" aria-label="关闭学习并返回首页" onClick={exit}>
        <AppIcon name="close" size={22} />
      </button>
      <span aria-label={`学习进度 ${progress}`}>{progress}</span>
    </header>

    <main className="new-learning-card">
      {!isStudy && <p className="eyebrow">先回想英文表达</p>}
      {!isStudy && <h1>{current.chinese}</h1>}
      {showAnswer && <div className="new-learning-answer">
        {isStudy && <h1 className="new-learning-english">{current.english}</h1>}
        {!isStudy && <h2 className="new-learning-english">{current.english}</h2>}
        {isStudy && <p className="new-learning-chinese">{current.chinese}</p>}
        {showContext && <section className="new-learning-context" aria-label="使用场景">
          <h3>使用场景</h3>
          {current.intent && <p className="new-learning-intent">{current.intent}</p>}
          {current.sourceNote && <p className="new-learning-source-note">{current.sourceNote}</p>}
        </section>}
        {showExamples && controller.examples.length > 0 && <section className="new-learning-examples">
          <h2>例句</h2>
          <ol aria-label="例句">
            {controller.examples.slice(0, 2).map((example) => <li key={example.id}>
              <p className="new-learning-example-english">{example.english}</p>
              <p className="new-learning-example-chinese">{example.chinese}</p>
            </li>)}
          </ol>
        </section>}
      </div>}
    </main>

    {(controller.error || status) && <p className="new-learning-status" role="status">
      {status || controller.error}
    </p>}

    <footer className="new-learning-actions">
      {showAnswer && <button type="button" disabled={disabled} onClick={() => { void run(controller.replay); }}>
        <AppIcon name="speaker" size={20} />重听标准发音
      </button>}
      {isStudy && <button type="button" className="primary" disabled={disabled} onClick={() => { void run(controller.nextStudyPhrase); }}>
        {index + 1 >= controller.total ? "开始小测试" : "下一句"}
      </button>}
      {!isStudy && !controller.revealed && <button type="button" className="primary" disabled={disabled} onClick={() => { void run(controller.reveal); }}>
        查看答案
      </button>}
      {!isStudy && controller.revealed && <div className="new-learning-grades" aria-label="自我评分">
        <button type="button" disabled={disabled} onClick={() => grade("again")}>不会</button>
        <button type="button" disabled={disabled} onClick={() => grade("hard")}>模糊</button>
        <button type="button" disabled={disabled} onClick={() => grade("good")}><AppIcon name="completion" size={18} />掌握</button>
      </div>}
    </footer>
  </section>;
}
