import { render, screen, within } from "@testing-library/react";
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
  it("updates the visible progress total when the session queue grows", () => {
    const { rerender } = render(<SpeakingPractice controller={controller()} onPause={vi.fn()} onHome={vi.fn()} onAgain={vi.fn()} />);
    expect(screen.getByText(/1 \/ 3/)).toBeVisible();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "3");

    rerender(<SpeakingPractice controller={controller({ total: 4 })} onPause={vi.fn()} onHome={vi.fn()} onAgain={vi.fn()} />);
    expect(screen.getByText(/1 \/ 4/)).toBeVisible();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "4");
  });

  it("labels daily review as Chinese recall while keeping English out of the prompt", async () => {
    const user = userEvent.setup();
    const value = controller();
    const onPause = vi.fn();
    const { container } = render(<SpeakingPractice controller={value} onPause={onPause} onHome={vi.fn()} onAgain={vi.fn()} />);
    const header = container.querySelector(".practice-head");
    expect(header).not.toBeNull();
    const modeLabel = within(header as HTMLElement).getByText("今日复习 · 中文回忆");
    expect(modeLabel).toHaveClass("task-mode", "task-mode-review");
    expect(screen.getByRole("progressbar", { name: "今日复习进度" })).toHaveAttribute("aria-valuemin", "0");
    expect(screen.getByRole("progressbar", { name: "今日复习进度" })).toHaveAttribute("aria-valuemax", "3");
    expect(screen.getByRole("progressbar", { name: "今日复习进度" })).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByText("先用英语表达")).toBeVisible();
    expect(screen.getByText("英文答案已隐藏")).toHaveClass("review-hidden-answer");
    expect(screen.getByText("我还没决定。")).toBeVisible();
    expect(screen.queryByText("I haven't decided yet.")).not.toBeInTheDocument();
    expect(screen.queryByText("I haven't decided yet whether to go.")).not.toBeInTheDocument();
    const unknown = screen.getByRole("button", { name: "不会，直接看答案" });
    const pronunciation = screen.getByRole("button", { name: "先听发音" });
    const selfAssessment = screen.getByRole("button", { name: "查看英文答案并自评" });
    expect(unknown.parentElement).toBe(pronunciation.parentElement);
    expect(unknown.parentElement).toHaveClass("prompt-secondary-actions");
    expect(unknown.parentElement?.nextElementSibling).toBe(selfAssessment);
    await user.click(unknown);
    await user.click(pronunciation);
    await user.click(selfAssessment);
    expect(value.revealAsUnknown).toHaveBeenCalledOnce();
    expect(value.usePronunciationHint).toHaveBeenCalledOnce();
    expect(value.revealForSelfAssessment).toHaveBeenCalledOnce();
    expect(value.startRecording).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "按住说英语" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "保存进度并返回" }));
    expect(onPause).toHaveBeenCalledOnce();
  });


  it("shows initialization recovery actions", async () => {
    const onHome = vi.fn(); const onAgain = vi.fn(); const user = userEvent.setup();
    render(<SpeakingPractice controller={controller({ initializationError: "训练内容暂时无法加载，请检查本地数据后重试。", current: undefined })} onPause={vi.fn()} onHome={onHome} onAgain={onAgain} />);
    expect(screen.getByRole("alert")).toHaveTextContent("训练内容暂时无法加载");
    await user.click(screen.getByRole("button", { name: "返回首页" }));
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(onHome).toHaveBeenCalledOnce(); expect(onAgain).toHaveBeenCalledOnce();
  });

  it("shows the answer, recording playback and caps mastery after a hint", async () => {
    const user = userEvent.setup();
    const value = controller({ phase: "answer", usedHint: true, recordingUrl: "blob:voice" });
    const { container } = render(<SpeakingPractice controller={value} onPause={vi.fn()} onHome={vi.fn()} onAgain={vi.fn()} />);
    const header = container.querySelector(".practice-head");
    expect(header).not.toBeNull();
    const modeLabel = within(header as HTMLElement).getByText("今日复习 · 中文回忆");
    expect(modeLabel).toHaveClass("task-mode", "task-mode-review");
    expect(screen.queryByText("英文答案已隐藏")).not.toBeInTheDocument();
    expect(screen.getByText("I haven't decided yet.")).toBeVisible();
    expect(screen.getByText("I haven't decided yet whether to go.")).toBeVisible();
    expect(screen.getByRole("button", { name: "不会" })).toBeVisible();
    expect(screen.getByRole("button", { name: "模糊" })).toBeVisible();
    expect(screen.getByRole("button", { name: "掌握" })).toBeDisabled();
    expect(screen.getByLabelText("播放我的录音")).toHaveAttribute("src", "blob:voice");
    await user.click(screen.getByRole("button", { name: "再听标准发音" }));
    await user.click(screen.getByRole("button", { name: "跟读一次" }));
    expect(value.repeatPronunciation).toHaveBeenCalledTimes(2);
  });

  it("offers completion actions", async () => {
    const user = userEvent.setup();
    const onHome = vi.fn(); const onAgain = vi.fn();
    render(<SpeakingPractice controller={controller({ phase: "complete", current: undefined })} onPause={vi.fn()} onHome={onHome} onAgain={onAgain} />);
    expect(screen.getByText("本组有效练习 0 分钟")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "回到首页" }));
    await user.click(screen.getByRole("button", { name: "再练一组" }));
    expect(onHome).toHaveBeenCalledOnce(); expect(onAgain).toHaveBeenCalledOnce();
  });
});
