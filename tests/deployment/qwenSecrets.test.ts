import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const excluded = new Set([".git", ".next", ".superpowers", ".vinext", ".worktrees", "node_modules", "dist"]);
const textFile = /(?:\.(?:ts|tsx|js|json|md|ya?ml|example)|\.gitignore)$/;
function sourceFiles(directory = root): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (excluded.has(entry.name)) return [];
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return textFile.test(entry.name) ? [relative(root, path).replaceAll("\\", "/")] : [];
  });
}

describe("Qwen secret boundary", () => {
  it("reuses private server configuration before runtime overrides and checks without dumping secrets", () => {
    const compose = readFileSync(resolve(root, "compose.yaml"), "utf8");
    expect(compose.indexOf("/etc/phrase-bank/qwen-content.env")).toBeLessThan(compose.indexOf("/etc/phrase-bank/speech.env"));
    expect(compose).not.toContain("DASHSCOPE_API_KEY=");
    const verify = readFileSync(resolve(root, "scripts/verify-runtime-ai.ts"), "utf8");
    expect(verify).toContain("/compatible-mode/v1/models");
    expect(verify).toContain("paidGeneration: false");
    expect(verify).not.toMatch(/console\.(log|error)\(config/);
  });
  it("contains no tracked API-key-shaped credential", () => {
    const leaked = sourceFiles().filter((file) => /s[k]-[a-z0-9]{20,}/i.test(readFileSync(resolve(root, file), "utf8")));
    expect(leaked).toEqual([]);
  });

  it("documents names without values and keeps the client bundle away from the key", () => {
    const example = readFileSync(resolve(root, ".env.content.example"), "utf8");
    expect(example).toContain("DASHSCOPE_API_KEY=");
    expect(example).toContain("DASHSCOPE_BASE_URL=");
    expect(example).not.toMatch(/DASHSCOPE_API_KEY=.+/);
    // Runtime TTS now uses a server-only secret. Browser-reachable modules must not.
    const clientFiles = sourceFiles().filter((file) => file.startsWith("app/") && !file.startsWith("app/server/") && !file.startsWith("app/api/"));
    expect(clientFiles.some((file) => readFileSync(resolve(root, file), "utf8").includes("DASHSCOPE_API_KEY"))).toBe(false);
    const dockerIgnore = readFileSync(resolve(root, ".dockerignore"), "utf8");
    expect(dockerIgnore).toContain(".env*");
    expect(dockerIgnore).toContain("!.env.content.example");
    expect(dockerIgnore).toContain(".content-agent");
    expect(dockerIgnore).toContain(".superpowers");
    const gitIgnore = readFileSync(resolve(root, ".gitignore"), "utf8");
    expect(gitIgnore).toContain("/.content-agent/");
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { scripts?: Record<string, string> };
    expect(packageJson.scripts?.["content:qwen:local"]).toBe("tsx scripts/run-local-qwen-content-agent.ts");
  });

  it("keeps the local Qwen key outside the repository without a username-specific path", () => {
    const runbook = readFileSync(resolve(root, "docs/runbooks/qwen-content-update.md"), "utf8");
    expect(runbook).toContain("%USERPROFILE%\\.phrase-bank\\qwen-content.env");
    expect(runbook).not.toMatch(/[A-Za-z]:\\Users\\[^\\\r\n`]+\\\.phrase-bank\\qwen-content\.env/i);
    expect(runbook).toContain("不要把 Key 粘贴到聊天");
    expect(runbook).toContain("不要在终端中粘贴或输出 Key");
    expect(runbook).toContain("不得提交到仓库");
  });

  it("requires revocation, private server configuration, validation, and rollback", () => {
    const runbook = readFileSync(resolve(root, "docs/runbooks/qwen-content-update.md"), "utf8");
    expect(runbook).toContain("作废");
    expect(runbook).toContain("DASHSCOPE_API_KEY");
    expect(runbook).toContain("chmod 600");
    expect(runbook).toContain("content:qwen");
    expect(runbook).toContain("content:publish");
    expect(runbook).toContain("回滚");
  });
});
