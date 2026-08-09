import { render, screen } from "@testing-library/react";
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
