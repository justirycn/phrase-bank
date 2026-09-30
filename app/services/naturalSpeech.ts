import { BrowserSpeechService, type EnglishAccent } from "./speech";

type VoiceSource = "natural" | "device";
const preferenceKey = "phrase-voice-source-v1";
export function preferredVoiceSource(): VoiceSource { try { return localStorage.getItem(preferenceKey) === "device" ? "device" : "natural"; } catch { return "natural"; } }
export function setPreferredVoiceSource(value: VoiceSource) { try { localStorage.setItem(preferenceKey, value); } catch { /* The current session can still play. */ } }

export class NaturalSpeechService {
  private generation = 0;
  private controller?: AbortController;
  private audio?: HTMLAudioElement;
  private settle?: (error?: Error) => void;
  private cache = new Map<string, string>();
  lastSource: "natural" | "device" | "fallback" = "device";
  constructor(private device: BrowserSpeechService, private fetcher: typeof fetch = fetch, private makeAudio = () => new Audio()) {}
  listVoices() { return this.device.listVoices(); }
  async speak(text: string, accent: EnglishAccent): Promise<void> {
    this.cancel();
    const generation = this.generation;
    if (accent !== "en-US" || preferredVoiceSource() === "device") { this.lastSource = "device"; return this.device.speak(text, accent); }
    this.lastSource = "natural";
    const key = `${accent}:${text.trim()}`;
    const controller = new AbortController(); this.controller = controller;
    let url = this.cache.get(key);
    if (!url) {
      const timer = setTimeout(() => controller.abort(), 28_000);
      try {
        const response = await this.fetcher.call(globalThis, "/api/speech", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, accent }), signal: controller.signal });
        if (!response.ok) throw new Error("自然发音暂不可用");
        const blob = await response.blob();
        if (generation !== this.generation) throw new Error("发音已取消");
        url = URL.createObjectURL(blob); this.cache.set(key, url);
        if (this.cache.size > 30) { const oldest = this.cache.keys().next().value!; URL.revokeObjectURL(this.cache.get(oldest)!); this.cache.delete(oldest); }
      } catch {
        if (generation !== this.generation) throw new Error("发音已取消");
        this.lastSource = "fallback";
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("phrase-speech-fallback"));
        return this.device.speak(text, accent);
      } finally { clearTimeout(timer); }
    }
    if (generation !== this.generation) throw new Error("发音已取消");
    const audio = this.audio ??= this.makeAudio();
    audio.src = url; audio.preload = "auto";
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => finish(new Error("播放超时，请再次点击发音。")), 90_000);
      const finish = (error?: Error) => {
        if (settled) return; settled = true; clearTimeout(timer); audio.onended = null; audio.onerror = null; this.settle = undefined;
        if (error) { audio.pause(); reject(error); } else resolve();
      };
      this.settle = finish;
      audio.onended = () => finish();
      audio.onerror = () => { this.cache.delete(key); URL.revokeObjectURL(url!); finish(new Error("音频播放失败，请再试一次。")); };
      try { void audio.play().catch(() => finish(new Error("音频已准备好，请再点一次播放。"))); }
      catch { finish(new Error("音频已准备好，请再点一次播放。")); }
    });
  }
  cancel() {
    this.generation += 1; this.controller?.abort(); this.controller = undefined;
    this.settle?.(new Error("发音已取消")); this.audio?.pause(); this.device.cancel();
  }
  dispose() { this.cancel(); for (const url of this.cache.values()) URL.revokeObjectURL(url); this.cache.clear(); }
}
