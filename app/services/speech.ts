export type EnglishAccent = "en-US" | "en-GB";

export function selectVoice(
  voices: SpeechSynthesisVoice[],
  accent: EnglishAccent,
): SpeechSynthesisVoice | undefined {
  return voices.find((voice) => voice.lang.toLowerCase() === accent.toLowerCase())
    ?? voices.find((voice) => voice.lang.toLowerCase().startsWith("en"));
}

const unavailableMessage = "当前浏览器暂不支持发音，请继续练习";

export class BrowserSpeechService {
  listVoices(): SpeechSynthesisVoice[] {
    if (typeof globalThis.speechSynthesis === "undefined") return [];
    return globalThis.speechSynthesis.getVoices();
  }

  speak(text: string, accent: EnglishAccent): Promise<void> {
    if (
      typeof globalThis.speechSynthesis === "undefined"
      || typeof globalThis.SpeechSynthesisUtterance === "undefined"
    ) {
      return Promise.reject(new Error(unavailableMessage));
    }

    const synthesis = globalThis.speechSynthesis;
    synthesis.cancel();

    return new Promise<void>((resolve, reject) => {
      const utterance = new globalThis.SpeechSynthesisUtterance(text);
      utterance.lang = accent;
      const selectedVoice = selectVoice(synthesis.getVoices(), accent);
      if (selectedVoice) utterance.voice = selectedVoice;
      utterance.onend = () => resolve();
      utterance.onerror = () => reject(new Error("发音播放失败，请稍后再试"));

      try {
        synthesis.speak(utterance);
      } catch {
        reject(new Error("发音播放失败，请稍后再试"));
      }
    });
  }

  cancel(): void {
    if (typeof globalThis.speechSynthesis !== "undefined") {
      globalThis.speechSynthesis.cancel();
    }
  }
}
