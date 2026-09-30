import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ScenarioScreen from "../../app/components/screens/ScenarioScreen";
import type { PhraseRepository } from "../../app/storage/repository";
import { currentAttempt } from "../../app/domain/scenarios";

vi.mock("../../app/components/screens/screenSpeech", () => ({ screenSpeech: { speak: vi.fn(async () => undefined), cancel: vi.fn() } }));
const repository = { getSpeechPreferences: async () => ({ accent: "en-US", autoSpeak: false }), listPhrases: async () => [], listPhraseLearningStates: async () => [] } as unknown as PhraseRepository;

describe("scenario dialogue", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());
  async function start() {
    render(<ScenarioScreen repository={repository} onHome={vi.fn()} />);
    await waitFor(() => expect(screen.queryByText("正在读取练习进度…")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /外贸沟通/ }));
    fireEvent.click(screen.getByRole("button", { name: /寄样与确认交期/ }));
  }
  it("completes three turns without recording, disables independent after hints, and stays on completion", async () => {
    await start();
    fireEvent.click(screen.getByRole("button", { name: /展开参考表达/ }));
    fireEvent.click(screen.getByRole("button", { name: "不录音，直接说" }));
    expect(screen.getByRole("button", { name: "能独立说清楚" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "能说一些，还会卡" }));
    fireEvent.click(screen.getByRole("button", { name: "下一轮对话" }));
    expect(screen.getByText("When can you send the samples?")).toBeVisible();
    for (let turn = 1; turn < 3; turn += 1) {
      fireEvent.click(screen.getByRole("button", { name: "不录音，直接说" }));
      fireEvent.click(screen.getByRole("button", { name: "能独立说清楚" }));
      fireEvent.click(screen.getByRole("button", { name: turn === 2 ? "完成这段对话" : "下一轮对话" }));
    }
    expect(screen.getByText("这段对话，练完了")).toBeVisible();
    await waitFor(() => expect(screen.getByText("这段对话，练完了")).toBeVisible());
    expect(screen.getByText("用过提示 · 无录音练习")).toBeVisible();
  });
  it("retains the hint in local progress and starts a fresh attempt only on explicit retry", async () => {
    await start(); fireEvent.click(screen.getByRole("button", { name: /展开参考表达/ }));
    fireEvent.click(screen.getByRole("button", { name: "不录音，直接说" }));
    const saved = JSON.parse(localStorage.getItem("phrase-scenarios-v1:local")!);
    expect(currentAttempt(saved.progress.sessions[0]).usedHint).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "重新挑战" }));
    fireEvent.click(screen.getByRole("button", { name: "不录音，直接说" }));
    expect(screen.getByRole("button", { name: "能独立说清楚" })).toBeEnabled();
  });
  it("allows practice when microphone permission is denied", async () => {
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(new Error("denied")) } });
    vi.stubGlobal("MediaRecorder", class {});
    await start(); fireEvent.click(screen.getByRole("button", { name: "录下我的回答" }));
    await screen.findByText(/麦克风暂不可用/);
    fireEvent.click(screen.getByRole("button", { name: "不录音，直接说" }));
    expect(screen.getByRole("button", { name: "能说一些，还会卡" })).toBeEnabled();
  });
});
