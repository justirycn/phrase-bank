// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = () => readFileSync(resolve(process.cwd(), ".github/workflows/qwen-content-release.yml"), "utf8");

describe("Qwen content release workflow", () => {
  it("is manual, serialized, and reads Qwen credentials only on the server", () => {
    const source = workflow();
    expect(source).toContain("workflow_dispatch:");
    expect(source).toContain("group: phrase-bank-qwen-content");
    expect(source).toContain("cancel-in-progress: false");
    expect(source).toContain("contents: write");
    expect(source).toContain("CONTENT_VERSION: 2026.08.3");
    expect(source).toContain("--env-file /etc/phrase-bank/qwen-content.env");
    expect(source).not.toContain("secrets.DASHSCOPE");
    expect(source).not.toContain("DASHSCOPE_API_KEY=");
  });

  it("validates before committing and never force-pushes", () => {
    const source = workflow();
    expect(source).toContain("candidate-$CONTENT_VERSION.json");
    expect(source).toContain("report-$CONTENT_VERSION.json");
    expect(source).toContain("npm run content:publish -- --version $CONTENT_VERSION");
    expect(source).toContain("npm test");
    expect(source).toContain("npm run lint");
    expect(source).toContain("npm run build");
    expect(source).toContain("git diff --cached --check");
    expect(source).toContain("git push origin HEAD:main");
    expect(source.indexOf("npm test")).toBeLessThan(source.indexOf("git push origin HEAD:main"));
    expect(source).not.toContain("git push --force");
  });

  it("rejects an unsafe server environment and main-branch drift", () => {
    const source = workflow();
    expect(source).toContain("stat -c '%a' /etc/phrase-bank/qwen-content.env");
    expect(source).toContain('test "$env_mode" = "600"');
    expect(source).toContain("git status --porcelain --untracked-files=no");
    expect(source).toContain("git rev-parse origin/main");
    expect(source).toContain("main advanced during Qwen generation");
  });
});
