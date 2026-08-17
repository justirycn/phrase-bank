import type { AppPreferences, BackupEnvelope, Category, LearningSessionRecord, Phrase, PhraseLearningState, ReviewResult, SpeechPreferences, SystemContentPackage, TrainingEvent, TrainingSessionRecord } from "../domain/types";
import { LocalPhraseRepository } from "./indexedDbRepository";

export class AuthenticationError extends Error { name = "AuthenticationError"; }

export class CloudPhraseRepository extends LocalPhraseRepository {
  private ready = false;
  constructor(private fetcher: typeof fetch = fetch) { super(`phrase-cloud-${crypto.randomUUID()}`); }
  async initialize() {
    if (this.ready) return;
    const response = await this.fetcher.call(globalThis, "/api/repository", { credentials: "same-origin" });
    if (response.status === 401) throw new AuthenticationError("登录已过期");
    if (!response.ok) throw new Error("云端数据暂时无法加载");
    const { snapshot } = await response.json() as { snapshot?: BackupEnvelope };
    await super.initialize();
    if (snapshot?.format === "personal-phrase-bank") await super.importSnapshot(snapshot, "overwrite");
    this.ready = true;
  }
  private async sync() {
    const snapshot = await super.exportSnapshot();
    const body = await new Response(new Response(JSON.stringify({ snapshot })).body!.pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
    const response = await this.fetcher.call(globalThis, "/api/repository", { method: "PUT", headers: { "content-encoding": "gzip" }, body });
    if (response.status === 401) throw new AuthenticationError("登录已过期");
    if (!response.ok) throw new Error("云端数据保存失败");
  }
  override async savePhrase(v: Phrase) { await super.savePhrase(v); await this.sync(); }
  override async deletePhrase(v: string) { await super.deletePhrase(v); await this.sync(); }
  override async submitReview(id: string, result: ReviewResult, now?: Date, operationId?: string) { await super.submitReview(id, result, now, operationId); await this.sync(); }
  override async submitTrainingReview(v: TrainingEvent) { await super.submitTrainingReview(v); await this.sync(); }
  override async saveCategory(v: Category) { await super.saveCategory(v); await this.sync(); }
  override async deleteCategoryAndMigrate(id: string, target: string) { await super.deleteCategoryAndMigrate(id, target); await this.sync(); }
  override async saveTrainingEvent(v: TrainingEvent) { await super.saveTrainingEvent(v); await this.sync(); }
  override async saveTrainingSession(v: TrainingSessionRecord) { await super.saveTrainingSession(v); await this.sync(); }
  override async completeTrainingSession(id: string, at: Date) { await super.completeTrainingSession(id, at); await this.sync(); }
  override async saveSpeechPreferences(v: SpeechPreferences) { await super.saveSpeechPreferences(v); await this.sync(); }
  override async saveAppPreferences(v: AppPreferences) { await super.saveAppPreferences(v); await this.sync(); }
  override async savePhraseLearningState(v: PhraseLearningState) { await super.savePhraseLearningState(v); await this.sync(); }
  override async saveLearningSession(v: LearningSessionRecord) { await super.saveLearningSession(v); await this.sync(); }
  override async completeLearningSession(id: string, at: Date) { await super.completeLearningSession(id, at); await this.sync(); }
  override async submitFirstLearningReview(v: TrainingEvent, s: LearningSessionRecord) { await super.submitFirstLearningReview(v, s); await this.sync(); }
  override async installSystemContentPackage(v: SystemContentPackage) { await super.installSystemContentPackage(v); await this.sync(); }
  override async rollbackSystemContentPackage(v: string) { await super.rollbackSystemContentPackage(v); await this.sync(); }
  override async importSnapshot(v: BackupEnvelope, p: "skip" | "overwrite") { await super.importSnapshot(v, p); await this.sync(); }
}
