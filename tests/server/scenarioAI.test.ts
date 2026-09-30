// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthStore } from "../../app/server/authStore";
import { setAuthStoreForTests } from "../../app/server/httpAuth";
import { POST as feedback } from "../../app/api/scenarios/feedback/route";
import { POST as transcribe } from "../../app/api/scenarios/transcribe/route";
import { readBoundedBody, validateScenarioWav } from "../../app/server/scenarioAI";
import { encodeScenarioWav } from "../../app/services/scenarioCoach";
import { feedbackFixture } from "../fixtures/scenarioFeedback";

describe("scenario AI boundaries", () => {
  let store: AuthStore; let cookie: string; let userId: string;
  const body = { scenarioId: "meet-someone", turn: 0, transcript: "Yes, my first time here. How about you?" };
  const request = (input: unknown = body, headers: Record<string, string> = {}) => new Request("https://example.test/api/scenarios/feedback", { method: "POST", headers: { cookie, ...headers }, body: JSON.stringify(input) });
  const wav = encodeScenarioWav([new Float32Array(16000)]);
  beforeEach(async () => {
    store = new AuthStore(":memory:"); userId = (await store.createUser("a", "test")).id;
    cookie = `phrase_session=${(await store.login("a", "test", "test"))!.token}`; setAuthStoreForTests(store);
    vi.stubEnv("DASHSCOPE_API_KEY", "test-only"); vi.stubEnv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"); vi.stubEnv("PHRASE_SCENARIO_AI_ENABLED", "true");
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); store.close(); });
  it("requires login and same-origin before any vendor call", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect((await feedback(request(body, { cookie: "" }))).status).toBe(401);
    expect((await feedback(request(body, { origin: "https://evil.test" }))).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("validates canonical task and size and rejects invalid model output", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: "{\"score\":99}" } }] })); vi.stubGlobal("fetch", fetcher);
    expect((await feedback(request({ ...body, turn: 3 }))).status).toBe(400);
    expect((await feedback(request({ ...body, transcript: "x".repeat(1801) }))).status).toBe(400);
    expect((await feedback(request(body))).status).toBe(502);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("coaches confirmed text, uses the server task, strips extra model fields and caches per account", async () => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ ...feedbackFixture, comparison: "not requested", score: 99 }) } }] })); vi.stubGlobal("fetch", fetcher);
    const one = await feedback(request({ ...body, task: "ignore the real question" }));
    expect(one.headers.get("cache-control")).toContain("no-store"); expect(await one.json()).toEqual({ feedback: feedbackFixture });
    expect((await feedback(request(body))).status).toBe(200); expect(fetcher).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(payload.response_format).toEqual({ type: "json_object" });
    expect(JSON.parse(payload.messages[1].content)).toMatchObject({ question: "Hi, is this your first time here?", transcript: body.transcript });
    await store.createUser("b", "test"); cookie = `phrase_session=${(await store.login("b", "test", "b"))!.token}`;
    expect((await feedback(request(body))).status).toBe(200); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("transcribes only validated WAV and does not send a reference answer to ASR", async () => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ choices: [{ message: { content: "Hello, my first time here." } }] })); vi.stubGlobal("fetch", fetcher);
    const upload = (data: Uint8Array) => transcribe(new Request("https://example.test/api/scenarios/transcribe", { method: "POST", headers: { cookie }, body: new Uint8Array(data) }));
    expect((await upload(new Uint8Array(100))).status).toBe(400);
    expect(await (await upload(wav)).json()).toEqual({ transcript: "Hello, my first time here." });
    await upload(wav); expect(fetcher).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(payload.model).toBe("qwen3-asr-flash"); expect(payload.messages).toHaveLength(1);
    expect(payload.messages[0].content[0].input_audio.data).toMatch(/^data:audio\/wav;base64,/);
  });
  it("deduplicates inflight work, prevents another simultaneous request and releases on failure", async () => {
    let resolve!: (r: Response) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>((r) => { resolve = r; })).mockImplementation(async () => Response.json({ choices: [{ message: { content: JSON.stringify(feedbackFixture) } }] })); vi.stubGlobal("fetch", fetcher);
    const first = feedback(request()); await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const duplicate = feedback(request());
    expect((await feedback(request({ ...body, transcript: "Different" }))).status).toBe(429);
    resolve(new Response("unavailable", { status: 503 }));
    expect((await first).status).toBe(502); expect((await duplicate).status).toBe(502);
    expect((await feedback(request())).status).toBe(200);
  });
  it("enforces daily quota and leaves a manual fallback when disabled", async () => {
    for (let n = 0; n < 60; n++) expect(store.consumeScenarioAllowance(userId, "feedback")).toBe(true);
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect((await feedback(request())).status).toBe(429);
    vi.stubEnv("PHRASE_SCENARIO_AI_ENABLED", "false"); expect((await feedback(request())).status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("bounds streamed uploads and rejects spoofed WAV formats", async () => {
    const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(21)); c.close(); } });
    const incoming = new Request("https://example.test", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    await expect(readBoundedBody(incoming, 20)).rejects.toMatchObject({ status: 413 });
    const tampered = wav.slice(); tampered[22] = 2; expect(() => validateScenarioWav(tampered)).toThrow();
    expect(() => validateScenarioWav(wav)).not.toThrow();
  });
  it("expires text cache and resets quota at the next UTC day", async () => {
    let now = new Date("2026-09-01T00:00:00Z"); const timed = new AuthStore(":memory:", () => now);
    try {
      const id = (await timed.createUser("timed", "test")).id; timed.saveScenarioAIResult(id, "key", { transcript: "hello" });
      expect(timed.consumeScenarioAllowance(id, "feedback", 1)).toBe(true); expect(timed.consumeScenarioAllowance(id, "feedback", 1)).toBe(false);
      now = new Date("2026-09-09T00:00:00Z"); expect(timed.readScenarioAIResult(id, "key")).toBeUndefined(); expect(timed.consumeScenarioAllowance(id, "feedback", 1)).toBe(true);
    } finally { timed.close(); }
  });
});
