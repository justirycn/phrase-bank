import { afterEach, describe, expect, it, vi } from "vitest";
import { TemporaryRecorder } from "../../app/services/recorder";

class MockMediaRecorder {
  static instances: MockMediaRecorder[] = [];
  mimeType = "audio/webm;codecs=opus";
  state: RecordingState = "inactive";
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(public stream: MediaStream) {
    MockMediaRecorder.instances.push(this);
  }

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([]) } as BlobEvent);
    this.ondataavailable?.({ data: new Blob(["voice"]) } as BlobEvent);
    this.onstop?.();
  }
}

const makeStream = () => {
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
  return { stream: { getTracks: () => tracks } as unknown as MediaStream, tracks };
};

afterEach(() => {
  MockMediaRecorder.instances = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TemporaryRecorder", () => {
  it("requests audio and returns a URL for non-empty chunks using the recorder MIME type", async () => {
    const { stream, tracks } = makeStream();
    const getUserMedia = vi.fn(async () => stream);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:recording-1"),
      revokeObjectURL: vi.fn(),
    });

    const recorder = new TemporaryRecorder();
    await recorder.start();
    const result = await recorder.stop();

    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(result.url).toBe("blob:recording-1");
    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.blob.type).toBe("audio/webm;codecs=opus");
    expect(tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
  });

  it("revokes the prior URL and stops prior tracks when starting a new recording", async () => {
    const first = makeStream();
    const second = makeStream();
    const getUserMedia = vi.fn().mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:first"),
      revokeObjectURL,
    });

    const recorder = new TemporaryRecorder();
    await recorder.start();
    await recorder.stop();
    await recorder.start();

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:first");
    expect(first.tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
  });

  it("stops tracks and revokes the latest URL when disposed", async () => {
    const { stream, tracks } = makeStream();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => stream) },
    });
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:last"), revokeObjectURL });

    const recorder = new TemporaryRecorder();
    await recorder.start();
    await recorder.stop();
    recorder.dispose();

    expect(tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:last");
  });
});
