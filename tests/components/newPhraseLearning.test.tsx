import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NewPhraseLearning } from "../../app/components/NewPhraseLearning";
import type { NewPhraseLearningController } from "../../app/hooks/useNewPhraseLearning";

const phrase = {
  id: "core-1", english: "Could you give me a moment?", chinese: "可以稍等我一下吗？",
  categoryId: "daily", reviewStep: 0, masteryLevel: 0,
  nextReviewAt: "2026-08-11T00:00:00.000Z", createdAt: "2026-08-11T00:00:00.000Z",
  updatedAt: "2026-08-11T00:00:00.000Z", origin: "system" as const, kind: "core" as const,
  intent: "礼貌争取思考时间", sourceNote: "当你需要短暂整理思路时使用。",
};

function controller(overrides: Partial<NewPhraseLearningController> = {}): NewPhraseLearningController {
  return {
    phase: "study", current: phrase, examples: [], studyIndex: 0, testIndex: 0, total: 5,
    revealed: false, busy: false, replay: vi.fn(async () => undefined),
    nextStudyPhrase: vi.fn(async () => undefined), reveal: vi.fn(async () => undefined),
    grade: vi.fn(async () => undefined), retry: vi.fn(), ...overrides,
  };
}

const example = (id: string, english: string, chinese: string) => ({
  ...phrase, id, english, chinese, kind: "example" as const, parentPhraseId: phrase.id,
});

describe("NewPhraseLearning", () => {
  it("shows the system study card, context, and at most two ordered examples", async () => {
    const user = userEvent.setup();
    const value = controller({ examples: [
      example("e1", "Just give me a moment to check the details.", "请稍等，我核对一下细节。"),
      example("e2", "Could you give me a moment while I find that?", "我查找时可以稍等一下吗？"),
      example("e3", "This must not render.", "这一条不应显示。"),
    ] });
    render(<NewPhraseLearning controller={value} onHome={vi.fn()} />);

    expect(screen.getByRole("heading", { level: 1, name: phrase.english })).toBeVisible();
    expect(screen.getByText(phrase.chinese)).toBeVisible();
    expect(screen.getByText(phrase.intent)).toBeVisible();
    expect(screen.getByText(phrase.sourceNote)).toBeVisible();
    expect(screen.getByText("1 / 5")).toBeVisible();
    const list = screen.getByRole("list", { name: "例句" });
    expect(list).toContainElement(screen.getByText("Just give me a moment to check the details."));
    expect(list.querySelectorAll("li")).toHaveLength(2);
    expect(screen.queryByText("This must not render.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重听标准发音" }));
    await user.click(screen.getByRole("button", { name: "下一句" }));
    expect(value.replay).toHaveBeenCalledOnce();
    expect(value.nextStudyPhrase).toHaveBeenCalledOnce();
    expect(screen.queryByText(/录音|麦克风/)).not.toBeInTheDocument();
    expect(screen.queryByRole("audio")).not.toBeInTheDocument();
  });

  it("omits empty metadata and examples for a personal phrase", () => {
    const personal = { ...phrase, origin: "personal" as const, kind: "standalone" as const, intent: undefined, sourceNote: undefined };
    render(<NewPhraseLearning controller={controller({ current: personal, examples: [example("e1", "Hidden", "隐藏")] })} onHome={vi.fn()} />);
    expect(screen.queryByRole("list", { name: "例句" })).not.toBeInTheDocument();
    expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
    expect(screen.queryByText("使用场景")).not.toBeInTheDocument();
  });

  it("keeps test answers out of the DOM until revealed", async () => {
    const user = userEvent.setup();
    const value = controller({ phase: "test", current: phrase, testIndex: 4 });
    render(<NewPhraseLearning controller={value} onHome={vi.fn()} />);
    expect(screen.getByText("5 / 5")).toBeVisible();
    expect(screen.getByText(phrase.chinese)).toBeVisible();
    expect(screen.queryByText(phrase.english)).not.toBeInTheDocument();
    expect(screen.queryByText(phrase.intent)).not.toBeInTheDocument();
    expect(screen.queryByText("例句")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看答案" }));
    expect(value.reveal).toHaveBeenCalledOnce();
  });

  it("reveals the answer and maps the three self-ratings", async () => {
    const user = userEvent.setup();
    const value = controller({ phase: "test", revealed: true });
    render(<NewPhraseLearning controller={value} onHome={vi.fn()} />);
    expect(screen.getByRole("heading", { name: phrase.english })).toBeVisible();
    expect(screen.getByText(phrase.intent)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "重听标准发音" }));
    await user.click(screen.getByRole("button", { name: "不会" }));
    await user.click(screen.getByRole("button", { name: "模糊" }));
    await user.click(screen.getByRole("button", { name: "掌握" }));
    expect(value.replay).toHaveBeenCalledOnce();
    expect(value.grade).toHaveBeenNthCalledWith(1, "again");
    expect(value.grade).toHaveBeenNthCalledWith(2, "hard");
    expect(value.grade).toHaveBeenNthCalledWith(3, "good");
  });

  it("uses the final study action copy and disables actions while busy", () => {
    render(<NewPhraseLearning controller={controller({ studyIndex: 4, busy: true })} onHome={vi.fn()} />);
    expect(screen.getByRole("button", { name: "开始小测试" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "重听标准发音" })).toBeDisabled();
  });

  it("guards against rapid double submission while an action is pending", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const value = controller({ nextStudyPhrase: vi.fn(() => pending) });
    const user = userEvent.setup();
    render(<NewPhraseLearning controller={value} onHome={vi.fn()} />);
    const next = screen.getByRole("button", { name: "下一句" });
    await user.dblClick(next);
    expect(value.nextStudyPhrase).toHaveBeenCalledOnce();
    expect(next).toBeDisabled();
    release();
  });

  it("reports rejected actions as a retryable status", async () => {
    const user = userEvent.setup();
    render(<NewPhraseLearning controller={controller({ replay: vi.fn(async () => { throw new Error("speech"); }) })} onHome={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "重听标准发音" }));
    expect(await screen.findByRole("status")).toHaveTextContent("操作没有完成");
    expect(screen.getByRole("button", { name: "下一句" })).toBeEnabled();
  });

  it.each([
    ["loading", "正在准备今天的新语言块"],
    ["empty", "今天没有新的语言块需要学习"],
    ["complete", "本组已学习 5 个语言块"],
  ] as const)("renders the %s state", (phase, copy) => {
    const onHome = vi.fn();
    render(<NewPhraseLearning controller={controller({ phase, current: undefined })} onHome={onHome} />);
    expect(screen.getByText(copy)).toBeVisible();
    if (phase !== "loading") expect(screen.getByRole("button", { name: "返回首页" })).toBeVisible();
  });

  it("offers error recovery and an accessible exit", async () => {
    const user = userEvent.setup(); const onHome = vi.fn(); const value = controller({ phase: "error", current: undefined, error: "暂时无法加载" });
    render(<NewPhraseLearning controller={value} onHome={onHome} />);
    expect(screen.getByRole("alert")).toHaveTextContent("暂时无法加载");
    await user.click(screen.getByRole("button", { name: "重试" }));
    await user.click(screen.getByRole("button", { name: "返回首页" }));
    expect(value.retry).toHaveBeenCalledOnce(); expect(onHome).toHaveBeenCalledOnce();
  });

  it("exposes the top close action with an accessible name", async () => {
    const user = userEvent.setup(); const onHome = vi.fn();
    render(<NewPhraseLearning controller={controller()} onHome={onHome} />);
    await user.click(screen.getByRole("button", { name: "关闭学习并返回首页" }));
    expect(onHome).toHaveBeenCalledOnce();
  });
});
