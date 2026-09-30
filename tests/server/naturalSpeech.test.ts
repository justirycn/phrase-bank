// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { synthesizeEnglish } from "../../app/server/naturalSpeech";
import { AuthStore } from "../../app/server/authStore";

describe("server speech", () => {
  const config = { apiKey: "test-only", endpoint: "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation", model: "qwen3-tts-flash", voice: "Jennifer" };
  it("sends the documented English request and downloads only vendor audio over HTTPS", async () => {
    const bytes = new Uint8Array(44); bytes.set(new TextEncoder().encode("RIFF")); bytes.set(new TextEncoder().encode("WAVE"), 8);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ output: { audio: { url: "http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/test.wav" } } })).mockResolvedValueOnce(new Response(bytes));
    expect(await synthesizeEnglish("Hello", config, fetcher)).toEqual(bytes);
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).input).toEqual({ text: "Hello", voice: "Jennifer", language_type: "English" });
    expect(String(fetcher.mock.calls[1][0])).toMatch(/^https:\/\//);
  });
  it("rejects non-vendor audio URLs without fetching them", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ output: { audio: { url: "http://127.0.0.1/private" } } }));
    await expect(synthesizeEnglish("Hello", config, fetcher)).rejects.toThrow("无效"); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("isolates cached audio by account and limits fresh generation", async () => {
    const store = new AuthStore(":memory:");
    try {
      const a = await store.createUser("a", "test"); const b = await store.createUser("b", "test");
      store.saveSpeechAudio(a.id, "key", new Uint8Array([1, 2]));
      expect(store.readSpeechAudio(b.id, "key")).toBeUndefined();
      expect(store.consumeSpeechAllowance(a.id, 1)).toBe(true); expect(store.consumeSpeechAllowance(a.id, 1)).toBe(false);
      expect(Array.from(store.readSpeechAudio(a.id, "key")!)).toEqual([1, 2]);
    } finally { store.close(); }
  });
});
