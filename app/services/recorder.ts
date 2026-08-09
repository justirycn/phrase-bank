interface TemporaryRecording {
  blob: Blob;
  url: string;
}

function stopTracks(stream?: MediaStream): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export class TemporaryRecorder {
  private recorder?: MediaRecorder;
  private stream?: MediaStream;
  private chunks: Blob[] = [];
  private currentUrl?: string;

  async start(): Promise<void> {
    this.releaseActiveRecording();
    this.revokeCurrentUrl();

    if (!navigator.mediaDevices?.getUserMedia || typeof globalThis.MediaRecorder === "undefined") {
      throw new Error("当前浏览器暂不支持录音，请继续练习");
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    try {
      this.stream = stream;
      this.recorder = new globalThis.MediaRecorder(stream);
      this.chunks = [];
      this.recorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.chunks.push(event.data);
      };
      this.recorder.start();
    } catch (error) {
      stopTracks(stream);
      this.stream = undefined;
      this.recorder = undefined;
      throw error;
    }
  }

  stop(): Promise<TemporaryRecording> {
    const recorder = this.recorder;
    if (!recorder || recorder.state === "inactive") {
      return Promise.reject(new Error("当前没有正在进行的录音"));
    }

    return new Promise<TemporaryRecording>((resolve, reject) => {
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: recorder.mimeType });
        const url = URL.createObjectURL(blob);
        this.currentUrl = url;
        this.finishRecorder(recorder);
        resolve({ blob, url });
      };
      recorder.onerror = () => {
        this.finishRecorder(recorder);
        reject(new Error("录音失败，请稍后再试"));
      };

      try {
        recorder.stop();
      } catch (error) {
        this.finishRecorder(recorder);
        reject(error);
      }
    });
  }

  dispose(): void {
    this.releaseActiveRecording();
    this.revokeCurrentUrl();
  }

  private finishRecorder(recorder: MediaRecorder): void {
    if (this.recorder !== recorder) return;
    stopTracks(this.stream);
    this.stream = undefined;
    this.recorder = undefined;
    this.chunks = [];
  }

  private releaseActiveRecording(): void {
    const recorder = this.recorder;
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      try {
        recorder.stop();
      } catch {
        // Tracks are still released below when stopping the recorder fails.
      }
    }
    stopTracks(this.stream);
    this.recorder = undefined;
    this.stream = undefined;
    this.chunks = [];
  }

  private revokeCurrentUrl(): void {
    if (!this.currentUrl) return;
    URL.revokeObjectURL(this.currentUrl);
    this.currentUrl = undefined;
  }
}
