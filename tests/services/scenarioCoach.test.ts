import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeScenarioWav, requestScenarioFeedback, recordingToWav } from "../../app/services/scenarioCoach";
import { feedbackFixture } from "../fixtures/scenarioFeedback";
describe("scenario coaching client", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  it("encodes mono 16 kHz PCM with clamping and stereo mixing", () => {
    const bytes = encodeScenarioWav([new Float32Array([-2, 0, 1]), new Float32Array([-2, 0, 1])]); const view = new DataView(bytes.buffer);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF"); expect(view.getUint32(24, true)).toBe(16000); expect(view.getUint16(22, true)).toBe(1); expect(view.getInt16(44, true)).toBe(-32768); expect(view.getInt16(48, true)).toBe(32767);
    expect(() => encodeScenarioWav([new Float32Array(16000 * 92)])).toThrow();
  });
  it("binds native fetch correctly, sends confirmed text and validates results", async () => {
    const fetcher = vi.fn(function (this: unknown) { expect(this).toBe(globalThis); return Promise.resolve(Response.json({ feedback: feedbackFixture })); }); vi.stubGlobal("fetch", fetcher);
    const input = { scenarioId: "meet-someone", turn: 0, transcript: "Hello" }; expect(await requestScenarioFeedback(input, new AbortController().signal)).toEqual(feedbackFixture);
    expect(fetcher).toHaveBeenCalledWith("/api/scenarios/feedback", expect.objectContaining({ credentials: "same-origin", body: JSON.stringify(input) }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ feedback: { score: 99 } }))); await expect(requestScenarioFeedback(input, new AbortController().signal)).rejects.toThrow("不完整");
  });
  it("offers manual fallback when conversion is unsupported or oversized", async () => {
    vi.stubGlobal("OfflineAudioContext", undefined); await expect(recordingToWav(new Blob(["audio"]), new AbortController().signal)).rejects.toThrow("手动填写");
    await expect(recordingToWav(new Blob([new Uint8Array(8_000_001)]), new AbortController().signal)).rejects.toThrow("过大");
  });
  it("passes cancellation through to the network and shows provider errors", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)))));
    const pending = requestScenarioFeedback({ scenarioId: "meet-someone", turn: 0, transcript: "Hello" }, controller.signal); controller.abort(); await expect(pending).rejects.toThrow();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "额度已用完" }, { status: 429 }))); await expect(requestScenarioFeedback({ scenarioId: "meet-someone", turn: 0, transcript: "Hello" }, new AbortController().signal)).rejects.toThrow("额度");
  });
});
