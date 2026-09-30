import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScenarioCoach } from "../../app/components/screens/ScenarioCoach";
import { currentAttempt, newScenarioSession, updateScenario } from "../../app/domain/scenarios";
import type { PhraseRepository } from "../../app/storage/repository";
import { feedbackFixture } from "../fixtures/scenarioFeedback";
import { requestScenarioFeedback, transcribeRecording } from "../../app/services/scenarioCoach";
vi.mock("../../app/services/scenarioCoach", () => ({ requestScenarioFeedback: vi.fn(), transcribeRecording: vi.fn() }));
const addReview = vi.fn();
const repo = { addScenarioReview: addReview } as unknown as PhraseRepository;
function Harness({ recorded = true }: { recorded?: boolean }) {
  const [session, setSession] = useState(() => updateScenario(newScenarioSession("meet-someone"), { type: "practice", recorded }));
  const attempt = currentAttempt(session);
  return <><p>{attempt.usedHint ? "hinted" : "independent-eligible"}</p><ScenarioCoach key={attempt.id} attempt={attempt} scenarioId={session.scenarioId} title="见面" previousTranscript={session.attempts.at(-2)?.transcript} blob={recorded ? new Blob(["audio"]) : undefined} repository={repo} onAction={(action) => setSession((s) => updateScenario(s, action))} onRetry={() => setSession((s) => updateScenario(updateScenario(s, { type: "retry" }), { type: "practice", recorded }))} retryAllowed onSpeak={vi.fn()} /></>;
}
describe("scenario coaching controls", () => {
  beforeEach(() => { vi.mocked(requestScenarioFeedback).mockReset().mockResolvedValue(feedbackFixture); vi.mocked(transcribeRecording).mockReset().mockResolvedValue("Yes, my first time here."); addReview.mockReset().mockResolvedValue(undefined); });
  afterEach(() => vi.restoreAllMocks());
  it("uploads only on click, lets the user correct ASR, and coaches only after confirmation", async () => {
    render(<Harness />); expect(transcribeRecording).not.toHaveBeenCalled(); expect(requestScenarioFeedback).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "上传录音并转写" }));
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("Yes, my first time here."));
    expect(requestScenarioFeedback).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Yes, it's my first time here. How about you?" } });
    fireEvent.click(screen.getByRole("button", { name: "确认文字，获取建议" }));
    await screen.findByText(feedbackFixture.summary);
    expect(requestScenarioFeedback).toHaveBeenCalledWith(expect.objectContaining({ transcript: "Yes, it's my first time here. How about you?" }), expect.any(AbortSignal)); expect(screen.getByText("hinted")).toBeVisible();
  });
  it("retains the previous confirmed answer for comparison and clears help on retry", async () => {
    render(<Harness recorded={false} />); fireEvent.change(screen.getByRole("textbox"), { target: { value: "My first time" } }); fireEvent.click(screen.getByRole("button", { name: "确认文字，获取建议" })); await screen.findByText(feedbackFixture.summary);
    fireEvent.click(screen.getByRole("button", { name: "按建议再说一次" })); expect(screen.getByRole("textbox")).toHaveValue(""); expect(screen.getByText("independent-eligible")).toBeVisible();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "It's my first time here." } }); fireEvent.click(screen.getByRole("button", { name: "确认文字，获取建议" })); await screen.findByText(feedbackFixture.summary);
    expect(requestScenarioFeedback).toHaveBeenLastCalledWith(expect.objectContaining({ previousTranscript: "My first time", transcript: "It's my first time here." }), expect.any(AbortSignal));
  });
  it("requires the user's practiced confirmation before adding review and supports failure retry", async () => {
    addReview.mockRejectedValueOnce(new Error("offline")); render(<Harness recorded={false} />); fireEvent.change(screen.getByRole("textbox"), { target: { value: "My first time" } }); fireEvent.click(screen.getByRole("button", { name: "确认文字，获取建议" })); await screen.findByText(feedbackFixture.summary);
    expect(screen.getByRole("button", { name: "加入我的复习" })).toBeDisabled(); expect(addReview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: "我已理解并开口练过这句" })); fireEvent.click(screen.getByRole("button", { name: "加入我的复习" })); await screen.findByText(/还没有加入成功/);
    fireEvent.click(screen.getByRole("button", { name: "加入我的复习" })); await screen.findByRole("button", { name: "已加入待复习" }); expect(addReview).toHaveBeenCalledTimes(2);
  });
  it("cancels waiting and ignores late feedback without freezing the controls", async () => {
    let finish!: (value: typeof feedbackFixture) => void; vi.mocked(requestScenarioFeedback).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })); render(<Harness recorded={false} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "My first time" } }); fireEvent.click(screen.getByRole("button", { name: "确认文字，获取建议" }));
    fireEvent.click(screen.getByRole("button", { name: "取消等待" })); await act(async () => finish(feedbackFixture));
    expect(screen.queryByText(feedbackFixture.summary)).not.toBeInTheDocument(); expect(screen.getByRole("button", { name: "确认文字，获取建议" })).toBeEnabled(); expect(screen.getByText("independent-eligible")).toBeVisible();
  });
  it("does not apply a late response after leaving the turn", async () => {
    let signal: AbortSignal | undefined; vi.mocked(requestScenarioFeedback).mockImplementationOnce((_input, value) => { signal = value; return new Promise(() => undefined); });
    const { unmount } = render(<Harness recorded={false} />); fireEvent.change(screen.getByRole("textbox"), { target: { value: "My first time" } }); fireEvent.click(screen.getByRole("button", { name: "确认文字，获取建议" })); unmount(); expect(signal?.aborted).toBe(true);
  });
  it("allows editing after failure, and hides advice for outdated text", async () => {
    vi.mocked(requestScenarioFeedback).mockRejectedValueOnce(new Error("请稍后重试")); render(<Harness recorded={false} />); fireEvent.change(screen.getByRole("textbox"), { target: { value: "My first time" } }); fireEvent.click(screen.getByRole("button", { name: "确认文字，获取建议" })); await screen.findByText("请稍后重试");
    fireEvent.click(screen.getByRole("button", { name: "确认文字，获取建议" })); await screen.findByText(feedbackFixture.summary); fireEvent.change(screen.getByRole("textbox"), { target: { value: "A different answer" } });
    expect(screen.queryByText(feedbackFixture.summary)).not.toBeInTheDocument(); expect(screen.getByRole("button", { name: "确认文字，获取建议" })).toBeEnabled(); expect(screen.getByText("hinted")).toBeVisible();
  });
});
