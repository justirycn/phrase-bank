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

class ControlledMediaRecorder extends MockMediaRecorder {
  stop() {
    this.state = "inactive";
  }
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

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

  it("stops every active track when disposed during recording", async () => {
    const { stream, tracks } = makeStream();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => stream) },
    });
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);
    vi.stubGlobal("URL", { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() });

    const recorder = new TemporaryRecorder();
    await recorder.start();
    recorder.dispose();

    expect(tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
  });

  it("revokes the latest completed recording URL when disposed", async () => {
    const { stream } = makeStream();
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

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:last");
  });

  it("cancels a deferred start immediately and stops its stale stream after a newer start", async () => {
    const first = deferred<MediaStream>();
    const second = deferred<MediaStream>();
    const firstMedia = makeStream();
    const secondMedia = makeStream();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) },
    });
    vi.stubGlobal("MediaRecorder", ControlledMediaRecorder);
    vi.stubGlobal("URL", { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() });
    const recorder = new TemporaryRecorder();

    const firstStart = recorder.start();
    const secondStart = recorder.start();
    await expect(firstStart).rejects.toThrow("录音已取消");
    first.resolve(firstMedia.stream);
    await vi.waitFor(() => {
      expect(firstMedia.tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
    });
    second.resolve(secondMedia.stream);
    await expect(secondStart).resolves.toBeUndefined();
    expect(secondMedia.tracks.every((track) => track.stop.mock.calls.length === 0)).toBe(true);
  });

  it("cancels a deferred start on disposal and stops the stream if permission resolves later", async () => {
    const pending = deferred<MediaStream>();
    const media = makeStream();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(() => pending.promise) },
    });
    vi.stubGlobal("MediaRecorder", ControlledMediaRecorder);
    vi.stubGlobal("URL", { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() });
    const recorder = new TemporaryRecorder();

    const starting = recorder.start();
    recorder.dispose();
    await expect(starting).rejects.toThrow("录音已取消");
    pending.resolve(media.stream);
    await vi.waitFor(() => {
      expect(media.tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
    });
  });

  it("settles a pending stop when a new recording starts and ignores the stale stop callback", async () => {
    const firstMedia = makeStream();
    const secondMedia = makeStream();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValueOnce(firstMedia.stream).mockResolvedValueOnce(secondMedia.stream) },
    });
    vi.stubGlobal("MediaRecorder", ControlledMediaRecorder);
    const createObjectURL = vi.fn(() => "blob:stale");
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    const recorder = new TemporaryRecorder();

    await recorder.start();
    const old = MockMediaRecorder.instances[0];
    const stopping = recorder.stop();
    const staleStop = old.onstop;
    await recorder.start();

    await expect(stopping).rejects.toThrow("录音已取消");
    staleStop?.();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(firstMedia.tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
  });

  it("settles a pending stop on disposal and never creates a late URL", async () => {
    const media = makeStream();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => media.stream) },
    });
    vi.stubGlobal("MediaRecorder", ControlledMediaRecorder);
    const createObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    const recorder = new TemporaryRecorder();

    await recorder.start();
    const old = MockMediaRecorder.instances[0];
    const stopping = recorder.stop();
    const staleStop = old.onstop;
    recorder.dispose();

    await expect(stopping).rejects.toThrow("录音已取消");
    staleStop?.();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(media.tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
  });

  it("settles only once when an error is followed by a late stop event", async () => {
    const media = makeStream();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => media.stream) },
    });
    vi.stubGlobal("MediaRecorder", ControlledMediaRecorder);
    const createObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    const recorder = new TemporaryRecorder();

    await recorder.start();
    const active = MockMediaRecorder.instances[0];
    const stopping = recorder.stop();
    const lateStop = active.onstop;
    active.onerror?.(new Event("error"));
    await expect(stopping).rejects.toThrow("录音失败，请稍后再试");
    lateStop?.();

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(media.tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
  });
});
