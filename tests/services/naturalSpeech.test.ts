import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NaturalSpeechService, setPreferredVoiceSource } from "../../app/services/naturalSpeech";
import { BrowserSpeechService, selectVoice } from "../../app/services/speech";

// Node's fetch Response and jsdom's Blob belong to different implementations.
// A byte body exercises the real response.blob() path on both Node 22 and 24.
const audioResponse = () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/wav" } });

describe("natural audio playback", () => {
  beforeEach(() => { localStorage.clear(); vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:voice"), revokeObjectURL: vi.fn() }); });
  afterEach(() => vi.unstubAllGlobals());
  const setup = (fetcher = vi.fn(async () => audioResponse())) => {
    const device = new BrowserSpeechService(); vi.spyOn(device, "speak").mockResolvedValue();
    const audio = { pause: vi.fn(), play: vi.fn(async () => undefined), src: "", preload: "", onended: null, onerror: null } as unknown as HTMLAudioElement;
    return { service: new NaturalSpeechService(device, fetcher, () => audio), audio, device, fetcher };
  };
  it("uses enhanced/premium voices instead of the first compact iPhone voice", () => {
    const voices = [ { lang: "en-US", name: "Samantha (Compact)" }, { lang: "en-US", name: "Ava (Premium)" } ] as SpeechSynthesisVoice[];
    expect(selectVoice(voices, "en-US")).toBe(voices[1]);
  });
  it("keeps a fetched clip when Safari needs a second tap, and does not regenerate it", async () => {
    const { service, audio, fetcher } = setup();
    vi.mocked(audio.play).mockRejectedValueOnce(new Error("NotAllowedError"));
    await expect(service.speak("Hello", "en-US")).rejects.toThrow("再点一次");
    const second = service.speak("Hello", "en-US");
    await vi.waitFor(() => expect(audio.play).toHaveBeenCalledTimes(2));
    audio.onended?.call(audio, new Event("ended")); await second;
    expect(fetcher).toHaveBeenCalledTimes(1); service.dispose();
  });
  it("never plays a cancelled request that returns late", async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
    const { service, audio, device } = setup(fetcher);
    const pending = service.speak("Hello", "en-US"); service.cancel(); finish(audioResponse());
    await expect(pending).rejects.toThrow("已取消"); expect(audio.play).not.toHaveBeenCalled(); expect(device.speak).not.toHaveBeenCalled();
  });
  it("falls back without freezing on unavailable cloud voice, and respects device preference", async () => {
    const { service, device, fetcher } = setup(vi.fn(async () => new Response(null, { status: 503 })));
    await service.speak("Hello", "en-US"); expect(device.speak).toHaveBeenCalledWith("Hello", "en-US"); expect(service.lastSource).toBe("fallback");
    setPreferredVoiceSource("device"); await service.speak("Again", "en-US"); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("binds fetch to the browser and releases clips when an account closes", async () => {
    const fetcher = vi.fn(function(this: unknown) {
      expect(this).toBe(globalThis);
      return Promise.resolve(audioResponse());
    });
    const { service, audio } = setup(fetcher);
    const playing = service.speak("Hello", "en-US");
    await vi.waitFor(() => expect(audio.play).toHaveBeenCalled());
    audio.onended?.call(audio, new Event("ended")); await playing;
    service.dispose();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:voice");
  });
});
