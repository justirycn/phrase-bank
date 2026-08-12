import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./database";
import { hashPassword, verifyPassword } from "./passwords";

type UserRow = { id: string; username: string; password_hash: string; salt: string; enabled: number };
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

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
    this.db.prepare("INSERT INTO user_documents VALUES (?, '{}', ?)").run(id, at);
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
    const row = this.db.prepare("SELECT document FROM user_documents WHERE user_id=?").get(userId) as { document: string } | undefined;
    return JSON.parse(row?.document ?? "{}");
  }
  async writeDocument(userId: string, document: unknown) {
    this.db.prepare("INSERT INTO user_documents VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET document=excluded.document, updated_at=excluded.updated_at").run(userId, JSON.stringify(document), this.now().toISOString());
  }
}
