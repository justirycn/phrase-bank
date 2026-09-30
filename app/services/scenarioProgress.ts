import { isScenarioProgress, type ScenarioProgress } from "../domain/scenarios";

export interface ScenarioDraft { progress: ScenarioProgress; revision: number; pending: boolean; operationId: string }
export class ScenarioConflictError extends Error {}
export class ScenarioProgressStore {
  private key: string;
  private current: ScenarioDraft = { progress: { sessions: [] }, revision: 0, pending: false, operationId: "" };
  private queue: Promise<unknown> = Promise.resolve();
  localSaved = false;
  constructor(username: string, private cloud = true, private fetcher: typeof fetch = fetch) { this.key = `phrase-scenarios-v1:${encodeURIComponent(username.toLowerCase())}`; }
  private writeLocal() {
    try { localStorage.setItem(this.key, JSON.stringify(this.current)); this.localSaved = true; }
    catch { this.localSaved = false; }
  }
  readLocal(): ScenarioProgress {
    try {
      const value = JSON.parse(localStorage.getItem(this.key) ?? "null") as ScenarioDraft | null;
      if (value && isScenarioProgress(value.progress) && Number.isSafeInteger(value.revision) && value.revision >= 0 && typeof value.pending === "boolean" && typeof value.operationId === "string") { this.current = value; this.localSaved = true; }
    } catch { this.localSaved = false; }
    return this.current.progress;
  }
  private async request(init?: RequestInit) {
    const response = await this.fetcher.call(globalThis, "/api/scenarios", { ...init, credentials: "same-origin", signal: AbortSignal.timeout(8000), headers: { "content-type": "application/json" } });
    if (response.status === 409) throw new ScenarioConflictError("另一台设备已有新进度。本机草稿已保留，请读取云端进度再继续。");
    if (!response.ok) throw new Error(response.status === 401 ? "登录已过期，请重新登录后同步。" : "云端暂时无法同步。");
    return response;
  }
  async load(discardLocal = false): Promise<ScenarioProgress> {
    if (!this.cloud) return this.current.progress;
    if (discardLocal && this.current.pending) {
      try { localStorage.setItem(`${this.key}:conflict-copy`, JSON.stringify(this.current)); }
      catch { throw new Error("本机草稿未能另存，请先导出草稿再处理冲突。"); }
    }
    if (this.current.pending && !discardLocal) { await this.sync(); return this.current.progress; }
    const result = await (await this.request()).json() as { progress: unknown; revision: number };
    if (!isScenarioProgress(result.progress) || !Number.isSafeInteger(result.revision)) throw new Error("云端场景记录格式错误。");
    this.current = { progress: result.progress, revision: result.revision, operationId: "", pending: false };
    this.writeLocal(); return this.current.progress;
  }
  save(progress: ScenarioProgress) {
    this.current = { ...this.current, progress, pending: true, operationId: crypto.randomUUID() };
    this.writeLocal();
    return this.sync();
  }
  sync(): Promise<void> {
    const operation = async () => {
      if (!this.cloud) {
        this.writeLocal();
        if (!this.localSaved) throw new Error("本机存储不可用，请保持页面打开。");
        return;
      }
      if (!this.current.pending) return;
      const sending = this.current;
      const response = await this.request({ method: "PUT", body: JSON.stringify(sending) });
      const result = await response.json() as { revision: number };
      if (!Number.isSafeInteger(result.revision)) throw new Error("同步返回无效版本。");
      this.current = { ...this.current, revision: result.revision, pending: this.current.operationId !== sending.operationId };
      this.writeLocal();
    };
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => undefined);
    return result;
  }
}
