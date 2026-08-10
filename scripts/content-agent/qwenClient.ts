export interface QwenMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface QwenClient {
  complete(messages: QwenMessage[]): Promise<string>;
}

export interface QwenClientOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  maxTokens?: number;
}

type CompletionResponse = { choices?: Array<{ message?: { content?: unknown } }> };

const pause = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export function createQwenClient(options: QwenClientOptions): QwenClient {
  if (!options.apiKey) throw new Error("缺少 DASHSCOPE_API_KEY");
  const fetcher = options.fetcher ?? fetch;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const timeoutMs = options.timeoutMs ?? 60_000;
  const retryDelayMs = options.retryDelayMs ?? 500;
  const endpoint = `${options.baseUrl.replace(/\/$/, "")}/chat/completions`;

  return {
    async complete(messages) {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetcher(endpoint, {
            method: "POST",
            headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: options.model, messages, stream: false, max_tokens: options.maxTokens ?? 8192 }),
            signal: controller.signal,
          });
          if (response.status === 401 || response.status === 403) throw new Error("Qwen 认证失败，请检查服务器密钥");
          if (!response.ok) {
            if ((response.status === 429 || response.status >= 500) && attempt < maxAttempts) {
              await pause(retryDelayMs);
              continue;
            }
            throw new Error(`Qwen 请求失败（HTTP ${response.status}）`);
          }
          let data: CompletionResponse;
          try { data = await response.json() as CompletionResponse; }
          catch { throw new Error("Qwen 返回格式无效"); }
          const content = data.choices?.[0]?.message?.content;
          if (typeof content !== "string" || !content.trim()) throw new Error("Qwen 返回格式无效");
          return content;
        } catch (error) {
          const isTimeout = controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
          if (isTimeout) {
            if (attempt < maxAttempts) { await pause(retryDelayMs); continue; }
            throw new Error("Qwen 请求超时");
          }
          if (error instanceof Error && error.message.startsWith("Qwen ")) throw error;
          if (attempt < maxAttempts) { await pause(retryDelayMs); continue; }
          throw new Error("Qwen 网络请求失败");
        } finally {
          clearTimeout(timeout);
        }
      }
      throw new Error("Qwen 请求失败");
    },
  };
}
