// Explicit opt-in smoke test: spends TTS + ASR + feedback API usage on synthetic, non-personal content.
// Run against an isolated local preview. Never use real user recordings or production credentials here.
import { encodeScenarioWav } from "../app/services/scenarioCoach";
import { isScenarioFeedback } from "../app/domain/scenarioCoaching";

if (process.env.PHRASE_VERIFY_PAID_AI !== "true") throw new Error("Set PHRASE_VERIFY_PAID_AI=true only after paid API authorization");
const url = new URL(process.env.PHRASE_VERIFY_URL ?? "http://127.0.0.1:4173");
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Only an isolated local test server is allowed");
const username = process.env.PHRASE_VERIFY_USERNAME; const password = process.env.PHRASE_VERIFY_PASSWORD;
if (!username || !password) throw new Error("Supply isolated test-account credentials using environment variables");
const login = await fetch(new URL("/api/auth/login", url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }), signal: AbortSignal.timeout(15_000) });
if (!login.ok) throw new Error("Test account login failed");
const cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
const call = (path: string, body: BodyInit, type: string) => fetch(new URL(path, url), { method: "POST", headers: { cookie, "content-type": type, origin: url.origin }, body, signal: AbortSignal.timeout(50_000) });
const speech = await call("/api/speech", JSON.stringify({ text: "Yes, it is my first time here. How about you?", accent: "en-US" }), "application/json");
if (!speech.ok) throw new Error(`TTS failed: ${speech.status}`);
const wav = new Uint8Array(await speech.arrayBuffer()); const view = new DataView(wav.buffer);
let sampleRate = 0; let channels = 0; let bits = 0; let pcm: Uint8Array | undefined;
for (let at = 12; at + 8 <= wav.length;) {
  const id = new TextDecoder().decode(wav.subarray(at, at + 4)); const declared = view.getUint32(at + 4, true);
  // DashScope can return a streaming WAV with a sentinel size instead of a finalized header.
  const size = id === "data" && declared >= 0x7fff0000 ? wav.length - at - 8 : declared;
  if (at + 8 + size > wav.length) throw new Error("Invalid TTS WAV");
  if (id === "fmt ") { channels = view.getUint16(at + 10, true); sampleRate = view.getUint32(at + 12, true); bits = view.getUint16(at + 22, true); }
  if (id === "data") pcm = wav.subarray(at + 8, at + 8 + size);
  at += 8 + size + (size % 2);
}
if (!pcm || bits !== 16 || !sampleRate || !channels) throw new Error("Unsupported TTS test format");
const dataView = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength); const frames = pcm.length / (2 * channels);
const samples = new Float32Array(Math.floor(frames * 16000 / sampleRate));
for (let i = 0; i < samples.length; i++) {
  const at = Math.min(frames - 1, Math.floor(i * sampleRate / 16000));
  for (let c = 0; c < channels; c++) samples[i] += dataView.getInt16((at * channels + c) * 2, true) / 32768 / channels;
}
const transcription = await call("/api/scenarios/transcribe", new Uint8Array(encodeScenarioWav([samples])), "audio/wav");
if (!transcription.ok) throw new Error(`ASR failed: ${transcription.status}`);
const { transcript } = await transcription.json() as { transcript: string };
if (!/first time/i.test(transcript)) throw new Error("ASR did not recover the synthetic test phrase");
const coaching = await call("/api/scenarios/feedback", JSON.stringify({ scenarioId: "meet-someone", turn: 0, transcript }), "application/json");
if (!coaching.ok) throw new Error(`Feedback failed: ${coaching.status}`);
const { feedback } = await coaching.json() as { feedback: unknown };
if (!isScenarioFeedback(feedback)) throw new Error("Feedback schema invalid");
console.log(JSON.stringify({ status: "passed", sample: "synthetic audio, not an iPhone microphone", wavBytes: wav.length, transcript, taskCheck: feedback.taskCheck, summary: feedback.summary }));
