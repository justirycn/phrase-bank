import { describe, expect, it, vi } from "vitest";
import { createQwenClient } from "../../scripts/content-agent/qwenClient";

const completion = (content = "result", status = 200) => new Response(JSON.stringify({
  choices: [{ message: { role: "assistant", content } }],
}), { status, headers: { "content-type": "application/json" } });

describe("Qwen client", () => {
  it("sends an OpenAI-compatible non-streaming request", async () => {
    const fetcher = vi.fn(async () => completion());
    const client = createQwenClient({ apiKey: "test-secret", baseUrl: "https://example.invalid/compatible-mode/v1/", model: "qwen-plus", fetcher, timeoutMs: 50, maxAttempts: 3 });

    await expect(client.complete([{ role: "user", content: "hello" }])).resolves.toBe("result");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://example.invalid/compatible-mode/v1/chat/completions");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer test-secret", "Content-Type": "application/json" });
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: "qwen-plus", stream: false, max_tokens: 8192, temperature: 0.2, messages: [{ role: "user", content: "hello" }] });
  });

  it("requires the server-side key", () => {
    expect(() => createQwenClient({ apiKey: "", baseUrl: "https://example.invalid/v1", model: "qwen-plus" })).toThrow("缺少 DASHSCOPE_API_KEY");
  });

  it("retries throttling and server failures up to the configured limit", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("busy", { status: 429 }))
      .mockResolvedValueOnce(new Response("down", { status: 503 }))
      .mockResolvedValueOnce(completion("recovered"));
    const client = createQwenClient({ apiKey: "test-secret", baseUrl: "https://example.invalid/v1", model: "qwen-plus", fetcher, retryDelayMs: 0, maxAttempts: 3 });

    await expect(client.complete([{ role: "user", content: "retry" }])).resolves.toBe("recovered");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("does not retry authentication failures or expose the key", async () => {
    const fetcher = vi.fn(async () => new Response("test-secret invalid", { status: 401 }));
    const client = createQwenClient({ apiKey: "test-secret", baseUrl: "https://example.invalid/v1", model: "qwen-plus", fetcher, maxAttempts: 3 });

    await expect(client.complete([{ role: "user", content: "auth" }])).rejects.toThrow("Qwen 认证失败");
    try { await client.complete([{ role: "user", content: "auth" }]); } catch (error) { expect(String(error)).not.toContain("test-secret"); }
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("reports timeout and malformed responses without leaking request data", async () => {
    const timeoutFetcher = vi.fn(async () => { throw new DOMException("test-secret timeout", "AbortError"); });
    const timeoutClient = createQwenClient({ apiKey: "test-secret", baseUrl: "https://example.invalid/v1", model: "qwen-plus", fetcher: timeoutFetcher, retryDelayMs: 0, maxAttempts: 1 });
    await expect(timeoutClient.complete([{ role: "user", content: "slow" }])).rejects.toThrow("Qwen 请求超时");

    const malformedClient = createQwenClient({ apiKey: "test-secret", baseUrl: "https://example.invalid/v1", model: "qwen-plus", fetcher: vi.fn(async () => new Response("{}", { status: 200 })), maxAttempts: 1 });
    await expect(malformedClient.complete([{ role: "user", content: "bad" }])).rejects.toThrow("Qwen 返回格式无效");
  });
});
