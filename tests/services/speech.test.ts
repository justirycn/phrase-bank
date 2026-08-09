import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserSpeechService, selectVoice } from "../../app/services/speech";

const voice = (lang: string, name = lang) => ({ lang, name }) as SpeechSynthesisVoice;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("selectVoice", () => {
  it("prefers an exact accent before another English voice", () => {
    const voices = [voice("en-GB", "British"), voice("en-US", "American")];
    expect(selectVoice(voices, "en-US")).toBe(voices[1]);
  });

  it("falls back to any English voice", () => {
    const voices = [voice("zh-CN"), voice("en-AU")];
    expect(selectVoice(voices, "en-US")).toBe(voices[1]);
  });

  it("returns undefined when no English voice exists", () => {
    expect(selectVoice([voice("zh-CN")], "en-GB")).toBeUndefined();
  });
});

describe("BrowserSpeechService", () => {
  it("lists voices, cancels prior speech, and speaks with the requested accent", async () => {
    const voices = [voice("en-US")];
    const synthesis = {
      getVoices: vi.fn(() => voices),
      cancel: vi.fn(),
      speak: vi.fn((utterance: SpeechSynthesisUtterance) => utterance.onend?.({} as SpeechSynthesisEvent)),
    };
    class Utterance {
      text: string;
      lang = "";
      voice: SpeechSynthesisVoice | null = null;
      onend: ((event: SpeechSynthesisEvent) => void) | null = null;
      onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null;

      constructor(text: string) {
        this.text = text;
      }
    }
    vi.stubGlobal("speechSynthesis", synthesis);
    vi.stubGlobal("SpeechSynthesisUtterance", Utterance);

    const service = new BrowserSpeechService();
    expect(service.listVoices()).toEqual(voices);
    await expect(service.speak("Hello", "en-US")).resolves.toBeUndefined();

    expect(synthesis.cancel).toHaveBeenCalledBefore(synthesis.speak);
    const spoken = synthesis.speak.mock.calls[0][0];
    expect(spoken).toMatchObject({ text: "Hello", lang: "en-US", voice: voices[0] });
  });

  it("rejects with a non-blocking Chinese message when speech is unavailable", async () => {
    vi.stubGlobal("speechSynthesis", undefined);
    vi.stubGlobal("SpeechSynthesisUtterance", undefined);
    await expect(new BrowserSpeechService().speak("Hello", "en-US")).rejects.toThrow(
      "当前浏览器暂不支持发音，请继续练习",
    );
  });

  it("rejects when the browser reports a speech error", async () => {
    const synthesis = {
      getVoices: vi.fn(() => []),
      cancel: vi.fn(),
      speak: vi.fn((utterance: SpeechSynthesisUtterance) => utterance.onerror?.({ error: "network" } as SpeechSynthesisErrorEvent)),
    };
    class Utterance {
      lang = "";
      voice: SpeechSynthesisVoice | null = null;
      onend: ((event: SpeechSynthesisEvent) => void) | null = null;
      onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null;
      constructor(public text: string) {}
    }
    vi.stubGlobal("speechSynthesis", synthesis);
    vi.stubGlobal("SpeechSynthesisUtterance", Utterance);

    await expect(new BrowserSpeechService().speak("Hello", "en-GB")).rejects.toThrow("发音播放失败，请稍后再试");
  });

  it("rejects replaced speech and ignores its stale callbacks", async () => {
    const utterances: SpeechSynthesisUtterance[] = [];
    const synthesis = {
      getVoices: vi.fn(() => []),
      cancel: vi.fn(),
      speak: vi.fn((utterance: SpeechSynthesisUtterance) => utterances.push(utterance)),
    };
    class Utterance {
      lang = "";
      voice: SpeechSynthesisVoice | null = null;
      onend: ((event: SpeechSynthesisEvent) => void) | null = null;
      onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null;
      constructor(public text: string) {}
    }
    vi.stubGlobal("speechSynthesis", synthesis);
    vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
    const service = new BrowserSpeechService();

    const first = service.speak("First", "en-US");
    const staleEnd = utterances[0].onend;
    const second = service.speak("Second", "en-US");
    await expect(first).rejects.toThrow("发音已取消");

    let secondSettled = false;
    void second.finally(() => { secondSettled = true; });
    staleEnd?.({} as SpeechSynthesisEvent);
    await Promise.resolve();
    expect(secondSettled).toBe(false);

    utterances[1].onend?.({} as SpeechSynthesisEvent);
    await expect(second).resolves.toBeUndefined();
  });

  it("settles the active speech promise when cancelled without a browser callback", async () => {
    const synthesis = { getVoices: vi.fn(() => []), cancel: vi.fn(), speak: vi.fn() };
    class Utterance {
      lang = "";
      voice: SpeechSynthesisVoice | null = null;
      onend: ((event: SpeechSynthesisEvent) => void) | null = null;
      onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null;
      constructor(public text: string) {}
    }
    vi.stubGlobal("speechSynthesis", synthesis);
    vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
    const service = new BrowserSpeechService();

    const speaking = service.speak("Hello", "en-US");
    service.cancel();

    await expect(speaking).rejects.toThrow("发音已取消");
  });
});
