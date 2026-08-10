import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const tracked = () => execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);

describe("Qwen secret boundary", () => {
  it("contains no tracked API-key-shaped credential", () => {
    const leaked = tracked().filter((file) => /s[k]-[a-z0-9]{20,}/i.test(readFileSync(resolve(root, file), "utf8")));
    expect(leaked).toEqual([]);
  });

  it("documents names without values and keeps the client bundle away from the key", () => {
    const example = readFileSync(resolve(root, ".env.content.example"), "utf8");
    expect(example).toContain("DASHSCOPE_API_KEY=");
    expect(example).toContain("DASHSCOPE_BASE_URL=");
    expect(example).not.toMatch(/DASHSCOPE_API_KEY=.+/);
    const clientFiles = tracked().filter((file) => file.startsWith("app/"));
    expect(clientFiles.some((file) => readFileSync(resolve(root, file), "utf8").includes("DASHSCOPE_API_KEY"))).toBe(false);
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
