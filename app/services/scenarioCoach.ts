import { isScenarioFeedback, type ScenarioFeedback } from "../domain/scenarioCoaching";

export function encodeScenarioWav(channels: Float32Array[]): Uint8Array {
  const length = channels[0]?.length ?? 0;
  if (!length || !channels.length || channels.some((c) => c.length !== length) || length > 16000 * 91) throw new Error("录音长度不合适，请重录（最长 90 秒）");
  const bytes = new Uint8Array(44 + length * 2); const view = new DataView(bytes.buffer);
  const label = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i); };
  label(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); label(8, "WAVEfmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  label(36, "data"); view.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) {
    const sample = Math.max(-1, Math.min(1, channels.reduce((total, channel) => total + channel[i], 0) / channels.length));
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}
function cancellable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason); signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
export async function recordingToWav(blob: Blob, signal: AbortSignal): Promise<Uint8Array> {
  if (blob.size > 8_000_000 || !blob.size) throw new Error("录音文件过大或为空，请重录或手动填写");
  if (typeof OfflineAudioContext === "undefined") throw new Error("当前浏览器无法转换录音，请手动填写回答");
  const context = new OfflineAudioContext(1, 1, 16000);
  const audio = await cancellable(blob.arrayBuffer().then((data) => context.decodeAudioData(data)), AbortSignal.any([signal, AbortSignal.timeout(15_000)]));
  if (audio.duration < 0.1 || audio.duration > 91 || audio.sampleRate !== 16000) throw new Error("请录制 1–90 秒的回答，或手动填写");
  return encodeScenarioWav(Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i)));
}
async function post(url: string, body: BodyInit, contentType: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  const result = await fetch.call(globalThis, url, { method: "POST", credentials: "same-origin", signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]), headers: { "content-type": contentType }, body });
  const json = await result.json().catch(() => ({})) as Record<string, unknown>;
  if (!result.ok) throw new Error(typeof json.error === "string" ? json.error : "暂时无法处理，请重试或直接自评");
  return json;
}
export async function transcribeRecording(blob: Blob, signal: AbortSignal): Promise<string> {
  const wav = await recordingToWav(blob, signal);
  signal.throwIfAborted();
  const data = await post("/api/scenarios/transcribe", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "audio/wav", signal);
  if (typeof data.transcript !== "string" || !data.transcript.trim() || data.transcript.length > 1800) throw new Error("未识别到清晰回答，可以直接修改文字");
  return data.transcript;
}
export async function requestScenarioFeedback(input: { scenarioId: string; turn: number; transcript: string; previousTranscript?: string }, signal: AbortSignal): Promise<ScenarioFeedback> {
  const data = await post("/api/scenarios/feedback", JSON.stringify(input), "application/json", signal);
  if (!isScenarioFeedback(data.feedback)) throw new Error("反馈不完整，请重试或直接自评");
  return data.feedback;
}
