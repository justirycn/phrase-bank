import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export async function qwenConfiguration() {
  let apiKey = process.env.DASHSCOPE_API_KEY?.trim();
  let base = process.env.DASHSCOPE_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1";
  const path = process.env.PHRASE_TTS_ENV_FILE ?? (process.env.NODE_ENV === "development" ? join(homedir(), ".phrase-bank", "qwen-content.env") : undefined);
  if (!apiKey && path) {
    try {
      const contents = await readFile(path, "utf8");
      const values = new Map(contents.split(/\r?\n/).filter((line) => /^(DASHSCOPE_API_KEY|DASHSCOPE_BASE_URL)=/.test(line)).map((line) => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")]; }));
      apiKey = values.get("DASHSCOPE_API_KEY"); base = values.get("DASHSCOPE_BASE_URL") ?? base;
    } catch { return undefined; }
  }
  if (!apiKey) return undefined;
  let host: string;
  try { host = new URL(base).hostname; } catch { return undefined; }
  if (!["dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com"].includes(host)) return undefined;
  return { apiKey, host, chatEndpoint: `https://${host}/compatible-mode/v1/chat/completions` };
}
export async function speechConfiguration() {
  if (process.env.PHRASE_TTS_ENABLED === "false") return undefined;
  const config = await qwenConfiguration();
  if (!config) return undefined;
  return { apiKey: config.apiKey, endpoint: `https://${config.host}/api/v1/services/aigc/multimodal-generation/generation`, model: "qwen3-tts-flash", voice: "Jennifer" };
}
export type SpeechConfiguration = NonNullable<Awaited<ReturnType<typeof speechConfiguration>>>;
export const speechCacheKey = (text: string, config: SpeechConfiguration) => createHash("sha256").update(JSON.stringify([config.model, config.voice, "English", text])).digest("hex");

export async function synthesizeEnglish(text: string, config: SpeechConfiguration, fetcher: typeof fetch = fetch): Promise<Uint8Array> {
  const signal = AbortSignal.timeout(25_000);
  const response = await fetcher(config.endpoint, { method: "POST", signal, headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ model: config.model, input: { text, voice: config.voice, language_type: "English" } }) });
  if (!response.ok) throw new Error("自然发音暂时无法生成");
  const result = await response.json() as { output?: { audio?: { url?: string } } };
  const url = new URL(result.output?.audio?.url ?? "invalid:");
  if (!/^dashscope-result-[a-z0-9-]+\.oss-[a-z0-9-]+\.aliyuncs\.com$/.test(url.hostname) || !["http:", "https:"].includes(url.protocol) || url.username || url.password || (url.port && url.port !== "443")) throw new Error("发音结果无效");
  url.protocol = "https:";
  const audio = await fetcher(url, { signal, redirect: "error" });
  if (!audio.ok || Number(audio.headers.get("content-length") ?? 0) > 3_000_000 || !audio.body) throw new Error("发音下载失败");
  const reader = audio.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.length; if (size > 3_000_000) { await reader.cancel(); throw new Error("发音文件过大"); } chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if (size < 44 || new TextDecoder().decode(bytes.slice(0, 4)) !== "RIFF" || new TextDecoder().decode(bytes.slice(8, 12)) !== "WAVE") throw new Error("发音格式无效");
  return bytes;
}
