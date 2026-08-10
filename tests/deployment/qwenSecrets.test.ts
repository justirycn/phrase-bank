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
  it("contains no tracked API-key-shaped credential", () => {
    const leaked = sourceFiles().filter((file) => /s[k]-[a-z0-9]{20,}/i.test(readFileSync(resolve(root, file), "utf8")));
    expect(leaked).toEqual([]);
  });

  it("documents names without values and keeps the client bundle away from the key", () => {
    const example = readFileSync(resolve(root, ".env.content.example"), "utf8");
    expect(example).toContain("DASHSCOPE_API_KEY=");
    expect(example).toContain("DASHSCOPE_BASE_URL=");
    expect(example).not.toMatch(/DASHSCOPE_API_KEY=.+/);
    const clientFiles = sourceFiles().filter((file) => file.startsWith("app/"));
    expect(clientFiles.some((file) => readFileSync(resolve(root, file), "utf8").includes("DASHSCOPE_API_KEY"))).toBe(false);
    const dockerIgnore = readFileSync(resolve(root, ".dockerignore"), "utf8");
    expect(dockerIgnore).toContain(".env*");
    expect(dockerIgnore).toContain("!.env.content.example");
    expect(dockerIgnore).toContain(".content-agent");
    expect(dockerIgnore).toContain(".superpowers");
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
