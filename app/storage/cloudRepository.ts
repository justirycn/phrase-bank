import type { AppPreferences, BackupEnvelope, BackupEnvelopeV5, Category, LearningSessionRecord, Phrase, PhraseLearningState, ReviewResult, SpeechPreferences, SystemContentPackage, TrainingEvent, TrainingSessionRecord } from "../domain/types";
import { LocalPhraseRepository } from "./indexedDbRepository";
import type { SnapshotImportPolicy } from "./repository";
import type { DiagnosticReporter } from "../services/diagnostics";
import type { ScenarioReviewInput } from "../domain/scenarioCoaching";

export class AuthenticationError extends Error { name = "AuthenticationError"; }

type RemoteDocument = { snapshot?: BackupEnvelope; revision: number };

const validRevision = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0;

export class CloudPhraseRepository extends LocalPhraseRepository {
  private ready = false;
  private revision = 0;
  private initializePromise?: Promise<void>;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private fetcher: typeof fetch = fetch,
    private requestTimeoutMs = 15_000,
    databaseName = `phrase-cloud-${crypto.randomUUID()}`,
    private reportDiagnostic: DiagnosticReporter = () => undefined,
  ) { super(databaseName); }

  private diagnosticContext(attempt?: number) {
    return { screen: "app" as const, ...(typeof navigator === "undefined" ? {} : { online: navigator.onLine }), ...(attempt === undefined ? {} : { attempt }) };
  }

  private async request(input: RequestInfo | URL, init: RequestInit | undefined, timeoutMessage: string) {
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error(timeoutMessage));
      }, this.requestTimeoutMs);
    });
    try {
      return await Promise.race([
        this.fetcher.call(globalThis, input, { ...init, signal: controller.signal }),
        timeout,
      ]);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }

  private async readRemote(): Promise<RemoteDocument> {
    const response = await this.request(
      "/api/repository",
      { credentials: "same-origin", cache: "no-store" },
      "云端数据加载超时，请检查网络后重试",
    );
    if (response.status === 401) throw new AuthenticationError("登录已过期");
    if (!response.ok) throw new Error("云端数据暂时无法加载");
    const remote = await response.json() as Partial<RemoteDocument>;
    const revision = remote.revision ?? 0;
    if (!validRevision(revision)) throw new Error("云端数据版本无效");
    return { snapshot: remote.snapshot, revision };
  }

  private async replaceFromRemote(remote: RemoteDocument) {
    if (remote.snapshot?.format === "personal-phrase-bank") {
      await super.importSnapshot(remote.snapshot, "replace");
    }
    this.revision = remote.revision;
  }

  override async initialize() {
    if (this.ready) return;
    if (!this.initializePromise) {
      this.initializePromise = (async () => {
        await super.initialize();
        await this.replaceFromRemote(await this.readRemote());
        this.ready = true;
      })().catch((error) => {
        this.initializePromise = undefined;
        this.reportDiagnostic("cloud_load_failed", this.diagnosticContext());
        throw error;
      });
    }
    await this.initializePromise;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async upload(snapshot: BackupEnvelopeV5) {
    const body = await new Response(new Response(JSON.stringify({ snapshot })).body!.pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
    return this.request(
      "/api/repository",
      {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-encoding": "gzip", "x-document-revision": String(this.revision) },
        body,
      },
      "云端数据保存超时，请重试",
    );
  }

  private mutateAndSync(mutate: () => Promise<void>) {
    return this.enqueue(async () => {
      if (!this.ready) await this.initialize();
      let rollback = await super.exportSnapshot();
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          await mutate();
          const response = await this.upload(await super.exportSnapshot());
          if (response.status === 401) throw new AuthenticationError("登录已过期");
          if (response.status === 409) {
            this.reportDiagnostic("cloud_sync_conflict", this.diagnosticContext(attempt + 1));
            const remote = await this.readRemote();
            await this.replaceFromRemote(remote);
            rollback = await super.exportSnapshot();
            continue;
          }
          if (!response.ok) throw new Error("云端数据保存失败");
          const result = await response.json() as { revision?: unknown };
          if (result.revision === undefined) this.revision += 1;
          else if (validRevision(result.revision)) this.revision = result.revision;
          else throw new Error("云端数据版本无效");
          return;
        } catch (error) {
          await super.importSnapshot(rollback, "replace");
          if (!(error instanceof AuthenticationError)) this.reportDiagnostic("cloud_sync_failed", this.diagnosticContext(attempt + 1));
          throw error;
        }
      }
      await super.importSnapshot(rollback, "replace");
      throw new Error("云端数据正在被另一台设备频繁更新，请稍后重试");
    });
  }

  private async syncTrainingCompletion(id: string, completedAt: Date) {
    const response = await this.request(
      "/api/repository",
      {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trainingSessionCompletion: { id, completedAt: completedAt.toISOString() } }),
      },
      "训练完成状态同步超时",
    );
    if (response.status === 401) throw new AuthenticationError("登录已过期");
    if (!response.ok) throw new Error("训练完成状态同步失败");
    const result = await response.json() as { revision?: unknown };
    if (result.revision === undefined) this.revision += 1;
    else if (validRevision(result.revision)) this.revision = result.revision;
    else throw new Error("云端数据版本无效");
  }

  override async savePhrase(value: Phrase) { await this.mutateAndSync(() => super.savePhrase(value)); }
  override async addScenarioReview(value: ScenarioReviewInput, now = new Date()) { await this.mutateAndSync(() => super.addScenarioReview(value, now)); }
  override async deletePhrase(id: string) { await this.mutateAndSync(() => super.deletePhrase(id)); }
  override async submitReview(id: string, result: ReviewResult, now = new Date(), operationId = crypto.randomUUID()) {
    await this.mutateAndSync(() => super.submitReview(id, result, now, operationId));
  }
  override async submitTrainingReview(value: TrainingEvent) { await this.mutateAndSync(() => super.submitTrainingReview(value)); }
  override async saveCategory(value: Category) { await this.mutateAndSync(() => super.saveCategory(value)); }
  override async deleteCategoryAndMigrate(id: string, target: string) { await this.mutateAndSync(() => super.deleteCategoryAndMigrate(id, target)); }
  override async saveTrainingEvent(value: TrainingEvent) { await this.mutateAndSync(() => super.saveTrainingEvent(value)); }
  override async saveTrainingSession(value: TrainingSessionRecord) { await this.mutateAndSync(() => super.saveTrainingSession(value)); }
  override async completeTrainingSession(id: string, completedAt: Date) {
    await super.completeTrainingSession(id, completedAt);
    void this.enqueue(async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try { await this.syncTrainingCompletion(id, completedAt); return; }
        catch { /* Keep the UI responsive while retrying the atomic server operation. */ }
      }
      this.reportDiagnostic("training_completion_sync_failed", this.diagnosticContext(3));
    });
  }
  override async saveSpeechPreferences(value: SpeechPreferences) { await this.mutateAndSync(() => super.saveSpeechPreferences(value)); }
  override async saveAppPreferences(value: AppPreferences) { await this.mutateAndSync(() => super.saveAppPreferences(value)); }
  override async savePhraseLearningState(value: PhraseLearningState) { await this.mutateAndSync(() => super.savePhraseLearningState(value)); }
  override async saveLearningSession(value: LearningSessionRecord) { await this.mutateAndSync(() => super.saveLearningSession(value)); }
  override async completeLearningSession(id: string, completedAt: Date) { await this.mutateAndSync(() => super.completeLearningSession(id, completedAt)); }
  override async submitFirstLearningReview(value: TrainingEvent, session: LearningSessionRecord) { await this.mutateAndSync(() => super.submitFirstLearningReview(value, session)); }
  override async installSystemContentPackage(value: SystemContentPackage) { await this.mutateAndSync(() => super.installSystemContentPackage(value)); }
  override async rollbackSystemContentPackage(version: string) { await this.mutateAndSync(() => super.rollbackSystemContentPackage(version)); }
  override async importSnapshot(value: BackupEnvelope, policy: SnapshotImportPolicy) { await this.mutateAndSync(() => super.importSnapshot(value, policy)); }

  override async close() {
    await this.mutationQueue;
    await super.close();
  }
}
