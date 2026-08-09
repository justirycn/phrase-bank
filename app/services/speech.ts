export type EnglishAccent = "en-US" | "en-GB";

interface SpeechOperation {
  utterance: SpeechSynthesisUtterance;
  settled: boolean;
  resolve: () => void;
  reject: (error: Error) => void;
}

export function selectVoice(
  voices: SpeechSynthesisVoice[],
  accent: EnglishAccent,
): SpeechSynthesisVoice | undefined {
  return voices.find((voice) => voice.lang.toLowerCase() === accent.toLowerCase())
    ?? voices.find((voice) => voice.lang.toLowerCase().startsWith("en"));
}

const unavailableMessage = "当前浏览器暂不支持发音，请继续练习";
const cancelledMessage = "发音已取消";

export class BrowserSpeechService {
  private current?: SpeechOperation;
  private voices: SpeechSynthesisVoice[] = [];

  constructor() {
    if (typeof globalThis.speechSynthesis === "undefined") return;
    this.refreshVoices();
    globalThis.speechSynthesis.addEventListener?.("voiceschanged", this.refreshVoices);
  }

  listVoices(): SpeechSynthesisVoice[] {
    if (typeof globalThis.speechSynthesis === "undefined") return [];
    this.refreshVoices();
    return this.voices;
  }

  speak(text: string, accent: EnglishAccent): Promise<void> {
    if (
      typeof globalThis.speechSynthesis === "undefined"
      || typeof globalThis.SpeechSynthesisUtterance === "undefined"
    ) {
      return Promise.reject(new Error(unavailableMessage));
    }

    const synthesis = globalThis.speechSynthesis;
    this.cancelCurrent();
    synthesis.cancel();

    return new Promise<void>((resolve, reject) => {
      this.refreshVoices();
      const selectedVoice = selectVoice(this.voices, accent);
      if (!selectedVoice) {
        reject(new Error("英文语音尚未准备好，请稍后再试"));
        return;
      }

      const utterance = new globalThis.SpeechSynthesisUtterance(text);
      const operation: SpeechOperation = { utterance, settled: false, resolve, reject };
      this.current = operation;

      utterance.lang = accent;
      utterance.voice = selectedVoice;
      utterance.onend = () => this.settle(operation);
      utterance.onerror = () => this.settle(operation, new Error("发音播放失败，请稍后再试"));

      try {
        synthesis.speak(utterance);
      } catch {
        this.settle(operation, new Error("发音播放失败，请稍后再试"));
      }
    });
  }

  cancel(): void {
    this.cancelCurrent();
    if (typeof globalThis.speechSynthesis !== "undefined") {
      globalThis.speechSynthesis.cancel();
    }
  }

  private cancelCurrent(): void {
    if (this.current) this.settle(this.current, new Error(cancelledMessage));
  }

  private refreshVoices = (): void => {
    if (typeof globalThis.speechSynthesis === "undefined") return;
    const available = globalThis.speechSynthesis.getVoices();
    if (available.length > 0) this.voices = available;
  };

  private settle(operation: SpeechOperation, error?: Error): void {
    if (operation.settled) return;
    operation.settled = true;
    operation.utterance.onend = null;
    operation.utterance.onerror = null;
    if (this.current === operation) this.current = undefined;
    if (error) operation.reject(error);
    else operation.resolve();
  }
}
