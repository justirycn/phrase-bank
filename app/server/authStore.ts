import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./database";
import { hashPassword, verifyPassword } from "./passwords";
import { isScenarioProgress, preservesScenarioHistory, type ScenarioProgress } from "../domain/scenarios";

type UserRow = { id: string; username: string; password_hash: string; salt: string; enabled: number };
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export class DocumentRevisionConflict extends Error {
  name = "DocumentRevisionConflict";
  constructor(readonly currentRevision: number) { super("云端数据已被其他设备更新"); }
}

export class AuthStore {
  private db: DatabaseSync;
  constructor(path: string, private now = () => new Date()) { this.db = openDatabase(path); }

  async createUser(username: string, password: string) {
    const normalized = username.trim();
    if (!normalized || !password) throw new Error("账号和密码不能为空");
    const existing = this.db.prepare("SELECT id FROM users WHERE username=?").get(normalized);
    if (existing) throw new Error("账号已存在");
    const id = randomUUID(); const material = await hashPassword(password); const at = this.now().toISOString();
    this.db.prepare("INSERT INTO users VALUES (?, ?, ?, ?, 1, ?, ?)").run(id, normalized, material.hash, material.salt, at, at);
    this.db.prepare("INSERT INTO user_documents (user_id, document, revision, updated_at) VALUES (?, '{}', 0, ?)").run(id, at);
    return { id, username: normalized };
  }

  passwordMaterial(username: string) {
    const row = this.db.prepare("SELECT password_hash, salt FROM users WHERE username=?").get(username) as { password_hash: string; salt: string } | undefined;
    return row ? `${row.salt}:${row.password_hash}` : "";
  }

  async login(username: string, password: string, source: string) {
    const attempt = this.db.prepare("SELECT failures, blocked_until FROM login_attempts WHERE source=?").get(source) as { failures: number; blocked_until?: string } | undefined;
    if (attempt?.blocked_until && new Date(attempt.blocked_until).getTime() > this.now().getTime()) return undefined;
    const row = this.db.prepare("SELECT * FROM users WHERE username=?").get(username.trim()) as UserRow | undefined;
    const valid = row?.enabled === 1 && await verifyPassword(password, row.salt, row.password_hash);
    if (!valid || !row) {
      const failures = (attempt?.failures ?? 0) + 1; const blocked = failures >= 5 ? new Date(this.now().getTime() + 5 * 60000).toISOString() : null;
      this.db.prepare("INSERT INTO login_attempts VALUES (?, ?, ?, ?) ON CONFLICT(source) DO UPDATE SET failures=excluded.failures, blocked_until=excluded.blocked_until, updated_at=excluded.updated_at").run(source, failures, blocked, this.now().toISOString());
      return undefined;
    }
    const token = randomBytes(32).toString("hex"); const now = this.now(); const expires = new Date(now.getTime() + 30 * 86400000);
    this.db.prepare("DELETE FROM login_attempts WHERE source=?").run(source);
    this.db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?)").run(tokenHash(token), row.id, expires.toISOString(), now.toISOString());
    return { token, user: { id: row.id, username: row.username }, expiresAt: expires };
  }

  async resolveSession(token: string) {
    const row = this.db.prepare("SELECT u.id, u.username, u.enabled, s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?").get(tokenHash(token)) as { id: string; username: string; enabled: number; expires_at: string } | undefined;
    if (!row || !row.enabled || new Date(row.expires_at).getTime() <= this.now().getTime()) return undefined;
    return { id: row.id, username: row.username };
  }

  async logout(token: string) { this.db.prepare("DELETE FROM sessions WHERE token_hash=?").run(tokenHash(token)); }
  async setEnabled(username: string, enabled: boolean) {
    const row = this.db.prepare("SELECT id FROM users WHERE username=?").get(username) as { id: string } | undefined;
    if (!row) throw new Error("账号不存在");
    this.db.prepare("UPDATE users SET enabled=?, updated_at=? WHERE id=?").run(enabled ? 1 : 0, this.now().toISOString(), row.id);
    if (!enabled) this.db.prepare("DELETE FROM sessions WHERE user_id=?").run(row.id);
  }
  async resetPassword(username: string, password: string) {
    const material = await hashPassword(password); const result = this.db.prepare("UPDATE users SET password_hash=?, salt=?, updated_at=? WHERE username=?").run(material.hash, material.salt, this.now().toISOString(), username);
    if (!result.changes) throw new Error("账号不存在");
  }
  listUsers() { return this.db.prepare("SELECT username, enabled FROM users ORDER BY username").all(); }
  async readDocument(userId: string) {
    return (await this.readDocumentRecord(userId)).document;
  }
  async readDocumentRecord(userId: string) {
    const row = this.db.prepare("SELECT document, revision FROM user_documents WHERE user_id=?").get(userId) as { document: string; revision: number } | undefined;
    return { document: JSON.parse(row?.document ?? "{}"), revision: row?.revision ?? 0 };
  }
  async writeDocument(userId: string, document: unknown, expectedRevision?: number) {
    const at = this.now().toISOString();
    if (expectedRevision === undefined) {
      this.db.prepare("INSERT INTO user_documents (user_id, document, revision, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(user_id) DO UPDATE SET document=excluded.document, revision=user_documents.revision+1, updated_at=excluded.updated_at").run(userId, JSON.stringify(document), at);
    } else {
      const result = this.db.prepare("UPDATE user_documents SET document=?, revision=revision+1, updated_at=? WHERE user_id=? AND revision=?").run(JSON.stringify(document), at, userId, expectedRevision);
      if (!result.changes) throw new DocumentRevisionConflict((await this.readDocumentRecord(userId)).revision);
    }
    return (await this.readDocumentRecord(userId)).revision;
  }
  async mutateDocument(userId: string, mutate: (document: unknown) => unknown) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare("SELECT document, revision FROM user_documents WHERE user_id=?").get(userId) as { document: string; revision: number } | undefined;
      const revision = row?.revision ?? 0;
      const document = mutate(JSON.parse(row?.document ?? "{}"));
      const nextRevision = revision + 1;
      this.db.prepare("INSERT INTO user_documents (user_id, document, revision, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET document=excluded.document, revision=excluded.revision, updated_at=excluded.updated_at")
        .run(userId, JSON.stringify(document), nextRevision, this.now().toISOString());
      this.db.exec("COMMIT");
      return { document, revision: nextRevision };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  recordDiagnostic(userId: string, event: { code: string; screen: string; online?: boolean; attempt?: number; appVersion: string }) {
    const createdAt = this.now().toISOString();
    this.db.prepare("INSERT INTO client_diagnostics (id, user_id, code, screen, online, attempt, app_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(randomUUID(), userId, event.code, event.screen, event.online === undefined ? null : event.online ? 1 : 0, event.attempt ?? null, event.appVersion, createdAt);
    this.db.prepare("DELETE FROM client_diagnostics WHERE user_id=? AND id NOT IN (SELECT id FROM client_diagnostics WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT 500)").run(userId, userId);
  }
  listDiagnostics(userId: string, limit = 50) {
    const bounded = Math.max(1, Math.min(500, Math.trunc(limit)));
    return this.db.prepare("SELECT code, screen, online, attempt, app_version AS appVersion, created_at AS createdAt FROM client_diagnostics WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT ?").all(userId, bounded);
  }
  readScenarioProgress(userId: string) {
    const row = this.db.prepare("SELECT document, revision, operation_id FROM scenario_documents WHERE user_id=?").get(userId) as { document: string; revision: number; operation_id: string } | undefined;
    const progress: unknown = JSON.parse(row?.document ?? '{"sessions":[]}');
    if (!isScenarioProgress(progress)) throw new Error("场景记录格式错误");
    return { progress, revision: row?.revision ?? 0, operationId: row?.operation_id ?? "" };
  }
  writeScenarioProgress(userId: string, progress: ScenarioProgress, expectedRevision: number, operationId: string) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.readScenarioProgress(userId);
      if (current.operationId === operationId) { this.db.exec("COMMIT"); return current.revision; }
      if (current.revision !== expectedRevision) throw new DocumentRevisionConflict(current.revision);
      if (!isScenarioProgress(progress) || !preservesScenarioHistory(current.progress, progress)) throw new Error("场景记录不能回退或清除提示历史");
      const revision = current.revision + 1;
      this.db.prepare("INSERT INTO scenario_documents VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET document=excluded.document, revision=excluded.revision, operation_id=excluded.operation_id").run(userId, JSON.stringify(progress), revision, operationId);
      this.db.exec("COMMIT"); return revision;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  consumeScenarioAllowance(userId: string, kind: "transcribe" | "feedback", limit = kind === "transcribe" ? 40 : 60) {
    const day = this.now().toISOString().slice(0, 10);
    this.db.prepare("DELETE FROM scenario_ai_usage WHERE day < ?").run(day);
    const result = this.db.prepare("INSERT INTO scenario_ai_usage VALUES (?, ?, ?, 1) ON CONFLICT(user_id, day, kind) DO UPDATE SET requests=requests+1 WHERE requests < ?").run(userId, day, kind, limit);
    return Boolean(result.changes);
  }
  readScenarioAIResult(userId: string, key: string): unknown {
    const cutoff = new Date(this.now().getTime() - 7 * 86400000).toISOString();
    this.db.prepare("DELETE FROM scenario_ai_cache WHERE created_at < ?").run(cutoff);
    const row = this.db.prepare("SELECT result FROM scenario_ai_cache WHERE user_id=? AND cache_key=?").get(userId, key) as { result: string } | undefined;
    return row ? JSON.parse(row.result) : undefined;
  }
  saveScenarioAIResult(userId: string, key: string, result: unknown) {
    this.db.prepare("INSERT OR REPLACE INTO scenario_ai_cache VALUES (?, ?, ?, ?)").run(userId, key, JSON.stringify(result), this.now().toISOString());
    this.db.prepare("DELETE FROM scenario_ai_cache WHERE user_id=? AND cache_key NOT IN (SELECT cache_key FROM scenario_ai_cache WHERE user_id=? ORDER BY created_at DESC, rowid DESC LIMIT 100)").run(userId, userId);
  }
  readSpeechAudio(userId: string, key: string) {
    return (this.db.prepare("SELECT audio FROM speech_audio WHERE user_id=? AND cache_key=?").get(userId, key) as { audio: Uint8Array } | undefined)?.audio;
  }
  saveSpeechAudio(userId: string, key: string, audio: Uint8Array) {
    this.db.prepare("INSERT OR REPLACE INTO speech_audio VALUES (?, ?, ?, ?)").run(userId, key, audio, this.now().toISOString());
    this.db.prepare("DELETE FROM speech_audio WHERE user_id=? AND cache_key NOT IN (SELECT cache_key FROM speech_audio WHERE user_id=? ORDER BY created_at DESC LIMIT 1500)").run(userId, userId);
    this.db.prepare("DELETE FROM speech_audio WHERE user_id=? AND cache_key IN (SELECT cache_key FROM (SELECT cache_key, SUM(length(audio)) OVER (ORDER BY created_at DESC, cache_key DESC) AS total FROM speech_audio WHERE user_id=?) WHERE total > 134217728)").run(userId, userId);
  }
  consumeSpeechAllowance(userId: string, limit = 100) {
    const day = this.now().toISOString().slice(0, 10);
    const result = this.db.prepare("INSERT INTO speech_usage VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET requests=requests+1 WHERE requests < ?").run(userId, day, limit);
    return result.changes > 0;
  }
  health() { return this.db.prepare("SELECT 1 AS ok").get() as { ok: number }; }
  close() { this.db.close(); }
}
