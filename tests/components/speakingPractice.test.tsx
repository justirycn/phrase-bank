import { render, screen } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SpeakingPractice } from "../../app/components/SpeakingPractice";
import type { TrainingSessionController } from "../../app/hooks/useTrainingSession";

function controller(overrides: Partial<TrainingSessionController> = {}): TrainingSessionController {
  return {
    phase: "prompt",
    current: {
      source: "due",
      phrase: {
        id: "phrase-1", english: "I haven't decided yet.", chinese: "我还没决定。",
        personalExample: "I haven't decided yet whether to go.", categoryId: "daily",
        reviewStep: 0, masteryLevel: 0, nextReviewAt: "2026-08-09T00:00:00.000Z",
        createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
      },
    },
    index: 0, total: 3, activeSeconds: 0, usedHint: false,
    startRecording: vi.fn(), stopRecording: vi.fn(), revealAsUnknown: vi.fn(),
    revealForSelfAssessment: vi.fn(),
    usePronunciationHint: vi.fn(), repeatPronunciation: vi.fn(), grade: vi.fn(async () => ({ accepted: true })),
    finish: vi.fn(), ...overrides,
  };
}

describe("SpeakingPractice", () => {
  it("keeps English hidden and wires the Chinese-first prompt actions", async () => {
    const user = userEvent.setup();
    const value = controller();
    render(<SpeakingPractice controller={value} onHome={vi.fn()} onAgain={vi.fn()} />);
    expect(screen.getByText("我还没决定。")).toBeVisible();
    expect(screen.queryByText("I haven't decided yet.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "不会，直接看答案" }));
    await user.click(screen.getByRole("button", { name: "按住说英语" }));
    await user.click(screen.getByRole("button", { name: "先听发音" }));
    expect(value.revealAsUnknown).toHaveBeenCalledOnce();
    expect(value.startRecording).toHaveBeenCalledOnce();
    expect(value.usePronunciationHint).toHaveBeenCalledOnce();
  });

  it("starts on pointer down and stops on pointer up", async () => {
    const stopRecording = vi.fn(async () => undefined);
    function Harness() {
      const [phase, setPhase] = useState<TrainingSessionController["phase"]>("prompt");
      const value = controller({ phase, startRecording: vi.fn(async () => setPhase("recording")), stopRecording });
      return <SpeakingPractice controller={value} onHome={vi.fn()} onAgain={vi.fn()} />;
    }
    render(<Harness />);
    const record = screen.getByRole("button", { name: "按住说英语" });
    record.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await screen.findByRole("button", { name: "我说完了" });
    expect(screen.getByRole("button", { name: "我说完了" })).toBe(record);
    record.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    await vi.waitFor(() => expect(stopRecording).toHaveBeenCalledOnce());
  });

  it("offers self assessment when microphone permission fails", async () => {
    const user = userEvent.setup();
    const value = controller({ startRecording: vi.fn(async () => { throw new Error("denied"); }) });
    render(<SpeakingPractice controller={value} onHome={vi.fn()} onAgain={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "按住说英语" }));
    expect(await screen.findByText("没有获得麦克风权限。你可以在浏览器设置中允许访问，或跳过录音继续练习。")).toBeVisible();
    expect(document.querySelector(".speaking-practice")).toHaveClass("has-microphone-fallback");
    await user.click(screen.getByRole("button", { name: "跳过录音，继续自评" }));
    expect(value.revealForSelfAssessment).toHaveBeenCalledOnce();
  });

  it("ends a pending keyboard recording and suppresses the synthesized click", async () => {
    let resolveStart!: () => void;
    const startRecording = vi.fn(() => new Promise<void>((resolve) => { resolveStart = resolve; }));
    const stopRecording = vi.fn(async () => undefined);
    render(<SpeakingPractice controller={controller({ startRecording, stopRecording })} onHome={vi.fn()} onAgain={vi.fn()} />);
    const record = screen.getByRole("button", { name: "按住说英语" });
    record.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    record.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));
    record.click();
    expect(startRecording).toHaveBeenCalledOnce();
    resolveStart();
    await vi.waitFor(() => expect(stopRecording).toHaveBeenCalledOnce());
    expect(startRecording).toHaveBeenCalledOnce();
  });

  it("shows initialization recovery actions", async () => {
    const onHome = vi.fn(); const onAgain = vi.fn(); const user = userEvent.setup();
    render(<SpeakingPractice controller={controller({ initializationError: "训练内容暂时无法加载，请检查本地数据后重试。", current: undefined })} onHome={onHome} onAgain={onAgain} />);
    expect(screen.getByRole("alert")).toHaveTextContent("训练内容暂时无法加载");
    await user.click(screen.getByRole("button", { name: "返回首页" }));
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(onHome).toHaveBeenCalledOnce(); expect(onAgain).toHaveBeenCalledOnce();
  });

  it("shows the answer, recording playback and caps mastery after a hint", async () => {
    const user = userEvent.setup();
    const value = controller({ phase: "answer", usedHint: true, recordingUrl: "blob:voice" });
    render(<SpeakingPractice controller={value} onHome={vi.fn()} onAgain={vi.fn()} />);
    expect(screen.getByText("I haven't decided yet.")).toBeVisible();
    expect(screen.getByText("I haven't decided yet whether to go.")).toBeVisible();
    expect(screen.getByRole("button", { name: "掌握" })).toBeDisabled();
    expect(screen.getByLabelText("播放我的录音")).toHaveAttribute("src", "blob:voice");
    await user.click(screen.getByRole("button", { name: "再听标准发音" }));
    await user.click(screen.getByRole("button", { name: "跟读一次" }));
    expect(value.repeatPronunciation).toHaveBeenCalledTimes(2);
  });

  it("stops recording and offers completion actions", async () => {
    const user = userEvent.setup();
    const recording = controller({ phase: "recording" });
    const { rerender } = render(<SpeakingPractice controller={recording} onHome={vi.fn()} onAgain={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "我说完了" }));
    expect(recording.stopRecording).toHaveBeenCalledOnce();

    const onHome = vi.fn(); const onAgain = vi.fn();
    rerender(<SpeakingPractice controller={controller({ phase: "complete", current: undefined })} onHome={onHome} onAgain={onAgain} />);
    expect(screen.getByText("本组有效练习 0 分钟")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "回到首页" }));
    await user.click(screen.getByRole("button", { name: "再练一组" }));
    expect(onHome).toHaveBeenCalledOnce(); expect(onAgain).toHaveBeenCalledOnce();
  });
});
