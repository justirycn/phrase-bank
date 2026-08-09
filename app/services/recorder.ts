interface TemporaryRecording {
  blob: Blob;
  url: string;
}

interface PendingStart {
  generation: number;
  cancel: () => void;
}

interface PendingStop {
  settled: boolean;
  resolve: (recording: TemporaryRecording) => void;
  reject: (error: Error) => void;
}

interface ActiveRecording {
  generation: number;
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  pendingStop?: PendingStop;
}

const cancelledError = () => new Error("录音已取消");

export class TemporaryRecorder {
  private generation = 0;
  private pendingStart?: PendingStart;
  private active?: ActiveRecording;
  private currentUrl?: string;
  private releasedStreams = new WeakSet<MediaStream>();

  start(): Promise<void> {
    const generation = ++this.generation;
    this.cancelPendingStart();
    this.cancelActive();
    this.revokeCurrentUrl();

    if (!navigator.mediaDevices?.getUserMedia || typeof globalThis.MediaRecorder === "undefined") {
      return Promise.reject(new Error("当前浏览器暂不支持录音，请继续练习"));
    }

    let rejectCancellation!: (error: Error) => void;
    const cancellation = new Promise<never>((_, reject) => {
      rejectCancellation = reject;
    });
    const pending: PendingStart = {
      generation,
      cancel: () => rejectCancellation(cancelledError()),
    };
    this.pendingStart = pending;

    const permission = Promise.resolve().then(() => navigator.mediaDevices.getUserMedia({ audio: true }));
    void permission.then(
      (stream) => {
        if (generation !== this.generation) this.releaseStream(stream);
      },
      () => undefined,
    );

    return Promise.race([permission, cancellation]).then(
      (stream) => {
        if (generation !== this.generation || this.pendingStart !== pending) {
          this.releaseStream(stream);
          throw cancelledError();
        }
        this.pendingStart = undefined;

        try {
          const recorder = new globalThis.MediaRecorder(stream);
          const active: ActiveRecording = { generation, recorder, stream, chunks: [] };
          recorder.ondataavailable = (event) => {
            if (this.active === active && event.data.size > 0) active.chunks.push(event.data);
          };
          recorder.start();
          this.active = active;
        } catch (error) {
          this.releaseStream(stream);
          throw error;
        }
      },
      (error: unknown) => {
        if (this.pendingStart === pending) this.pendingStart = undefined;
        throw error;
      },
    );
  }

  stop(): Promise<TemporaryRecording> {
    const active = this.active;
    if (!active || active.recorder.state === "inactive" || active.pendingStop) {
      return Promise.reject(new Error("当前没有正在进行的录音"));
    }

    return new Promise<TemporaryRecording>((resolve, reject) => {
      const pending: PendingStop = { settled: false, resolve, reject };
      active.pendingStop = pending;
      active.recorder.onstop = () => this.finishStop(active, pending);
      active.recorder.onerror = () => {
        this.finishStop(active, pending, new Error("录音失败，请稍后再试"));
      };

      try {
        active.recorder.stop();
      } catch (error) {
        this.finishStop(
          active,
          pending,
          error instanceof Error ? error : new Error("录音失败，请稍后再试"),
        );
      }
    });
  }

  dispose(): void {
    this.generation += 1;
    this.cancelPendingStart();
    this.cancelActive();
    this.revokeCurrentUrl();
  }

  private finishStop(active: ActiveRecording, pending: PendingStop, error?: Error): void {
    if (pending.settled) return;
    if (this.active !== active || active.pendingStop !== pending) {
      this.settlePendingStop(pending, cancelledError());
      return;
    }

    if (error) {
      this.cleanupActive(active);
      this.settlePendingStop(pending, error);
      return;
    }

    try {
      const blob = new Blob(active.chunks, { type: active.recorder.mimeType });
      const url = URL.createObjectURL(blob);
      this.revokeCurrentUrl();
      this.currentUrl = url;
      this.cleanupActive(active);
      this.settlePendingStop(pending, undefined, { blob, url });
    } catch (creationError) {
      this.cleanupActive(active);
      this.settlePendingStop(
        pending,
        creationError instanceof Error ? creationError : new Error("录音失败，请稍后再试"),
      );
    }
  }

  private settlePendingStop(
    pending: PendingStop,
    error?: Error,
    recording?: TemporaryRecording,
  ): void {
    if (pending.settled) return;
    pending.settled = true;
    if (error) pending.reject(error);
    else if (recording) pending.resolve(recording);
  }

  private cancelPendingStart(): void {
    const pending = this.pendingStart;
    this.pendingStart = undefined;
    pending?.cancel();
  }

  private cancelActive(): void {
    const active = this.active;
    if (!active) return;
    const pending = active.pendingStop;
    this.cleanupActive(active);
    if (pending) this.settlePendingStop(pending, cancelledError());
    if (active.recorder.state !== "inactive") {
      try {
        active.recorder.stop();
      } catch {
        // The owned stream has already been released.
      }
    }
  }

  private cleanupActive(active: ActiveRecording): void {
    active.recorder.ondataavailable = null;
    active.recorder.onstop = null;
    active.recorder.onerror = null;
    this.releaseStream(active.stream);
    active.chunks = [];
    active.pendingStop = undefined;
    if (this.active === active) this.active = undefined;
  }

  private releaseStream(stream: MediaStream): void {
    if (this.releasedStreams.has(stream)) return;
    this.releasedStreams.add(stream);
    stream.getTracks().forEach((track) => track.stop());
  }

  private revokeCurrentUrl(): void {
    if (!this.currentUrl) return;
    URL.revokeObjectURL(this.currentUrl);
    this.currentUrl = undefined;
  }
}
