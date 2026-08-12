import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const root = (...parts: string[]) => readFileSync(resolve(process.cwd(), ...parts), "utf8");
describe("cloud auth deployment", () => {
  it("persists SQLite without embedding passwords", () => {
    const compose = root("compose.yaml");
    expect(compose).toContain("PHRASE_DB_PATH=/app/data/phrase-bank.sqlite");
    expect(compose).toContain("phrase_data:/app/data");
    expect(compose).not.toMatch(/PASSWORD|1234/);
  });
  it("provides account management commands", () => {
    const pkg = JSON.parse(root("package.json"));
    for (const name of ["account:create", "account:reset", "account:disable", "account:enable", "account:list"]) expect(pkg.scripts[name]).toBeTruthy();
  });
  it("makes the mounted data directory writable by the runtime user", () => {
    expect(root("Dockerfile")).toContain("chown node:node /app/data");
  });
});
