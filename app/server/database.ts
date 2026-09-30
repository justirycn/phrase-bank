import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openDatabase(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, salt TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS user_documents (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, document TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS login_attempts (source TEXT PRIMARY KEY, failures INTEGER NOT NULL, blocked_until TEXT, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS client_diagnostics (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, code TEXT NOT NULL, screen TEXT NOT NULL, online INTEGER, attempt INTEGER, app_version TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS client_diagnostics_user_time ON client_diagnostics(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS scenario_documents (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, document TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, operation_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS speech_audio (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, cache_key TEXT NOT NULL, audio BLOB NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id, cache_key));
    CREATE TABLE IF NOT EXISTS speech_usage (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, day TEXT NOT NULL, requests INTEGER NOT NULL, PRIMARY KEY(user_id, day));
    CREATE TABLE IF NOT EXISTS scenario_ai_usage (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, day TEXT NOT NULL, kind TEXT NOT NULL, requests INTEGER NOT NULL, PRIMARY KEY(user_id, day, kind));
    CREATE TABLE IF NOT EXISTS scenario_ai_cache (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, cache_key TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id, cache_key));`);
  const documentColumns = db.prepare("PRAGMA table_info(user_documents)").all() as Array<{ name: string }>;
  if (!documentColumns.some(({ name }) => name === "revision")) {
    db.exec("ALTER TABLE user_documents ADD COLUMN revision INTEGER NOT NULL DEFAULT 0");
  }
  return db;
}
