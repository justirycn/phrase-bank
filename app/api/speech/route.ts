import { authStore, currentUser } from "../../server/httpAuth";
import { speechCacheKey, speechConfiguration, synthesizeEnglish } from "../../server/naturalSpeech";

const inflight = new Map<string, Promise<Uint8Array>>();
export async function GET(request: Request) {
  if (!await currentUser(request)) return Response.json({ error: "请先登录" }, { status: 401 });
  return Response.json({ available: Boolean(await speechConfiguration()), accent: "en-US", voice: "Jennifer", dailyGenerationLimit: 100 }, { headers: { "cache-control": "no-store" } });
}
export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "无效来源" }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > 5000) return Response.json({ error: "句子过长" }, { status: 413 });
  const raw = await request.text();
  if (raw.length > 5000) return Response.json({ error: "句子过长" }, { status: 413 });
  let input: { text?: unknown; accent?: unknown };
  try { input = JSON.parse(raw); } catch { return Response.json({ error: "无效请求" }, { status: 400 }); }
  if (!input || typeof input.text !== "string" || !input.text.trim() || input.text.length > 600 || input.accent !== "en-US") return Response.json({ error: "自然发音目前支持 600 字符以内的美式英语" }, { status: 400 });
  const config = await speechConfiguration();
  if (!config) return Response.json({ error: "自然发音尚未配置" }, { status: 503 });
  const text = input.text.trim(); const key = speechCacheKey(text, config); const pendingKey = `${user.id}:${key}`;
  const store = await authStore();
  const cached = store.readSpeechAudio(user.id, key);
  const response = (audio: Uint8Array, cache: string) => new Response(new Uint8Array(audio), { headers: { "content-type": "audio/wav", "cache-control": "private, no-store", "x-speech-cache": cache, "x-content-type-options": "nosniff" } });
  if (cached) return response(cached, "hit");
  if (!inflight.has(pendingKey)) {
    if (!store.consumeSpeechAllowance(user.id)) return Response.json({ error: "今日新语音额度已用完，已生成的语音仍可播放" }, { status: 429 });
    const job = synthesizeEnglish(text, config).then((audio) => { store.saveSpeechAudio(user.id, key, audio); return audio; });
    inflight.set(pendingKey, job);
    void job.finally(() => inflight.delete(pendingKey)).catch(() => undefined);
  }
  try { return response(await inflight.get(pendingKey)!, "miss"); }
  catch { return Response.json({ error: "自然发音暂时不可用，请稍后重试" }, { status: 502 }); }
}
