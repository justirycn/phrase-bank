// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = () => readFileSync(resolve(process.cwd(), ".github/workflows/qwen-content-release.yml"), "utf8");
const commandLine = (source: string, command: string) => {
  const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`^[ \\t]*(?:-[ \\t]+)?(?:run:[ \\t]*)?${escaped}[ \\t]*$`, "m"));
  expect(match, `expected workflow command: ${command}`).not.toBeNull();
  return match?.index ?? -1;
};
const patternPosition = (source: string, pattern: RegExp, description: string) => {
  const match = pattern.exec(source);
  expect(match, `expected ${description}`).not.toBeNull();
  return match?.index ?? -1;
};

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

    const secretNames = [...source.matchAll(/\$\{\{\s*secrets\.([A-Za-z0-9_]+)\s*\}\}/g)].map((match) => match[1]);
    expect(secretNames).toHaveLength(3);
    expect([...new Set(secretNames)].sort()).toEqual(["TENCENT_HOST", "TENCENT_SSH_KEY", "TENCENT_USER"]);

    const remoteArtifacts = [...source.matchAll(/\bscp\b[^\r\n]*:(\/opt\/phrase-bank\/\.content-agent\/(?:candidate|report)-\$CONTENT_VERSION\.json)/g)];
    expect(remoteArtifacts).toHaveLength(2);
    expect(remoteArtifacts.map((match) => match[1]).sort()).toEqual([
      "/opt/phrase-bank/.content-agent/candidate-$CONTENT_VERSION.json",
      "/opt/phrase-bank/.content-agent/report-$CONTENT_VERSION.json",
    ]);
    expect(source).not.toMatch(/\bscp\b[^\r\n]*(?:\s-r(?:\s|$)|\s--recursive(?:\s|$))/);
    expect(source).not.toMatch(/\b(?:scp|cp)\b[^\r\n]*(?:\/etc\/phrase-bank|qwen-content\.env)/);
  });

  it("validates before committing and never force-pushes", () => {
    const source = workflow();
    const focusedTests = "npm test -- tests/contentAgent tests/deployment/qwenSecrets.test.ts tests/deployment/qwenContentReleaseWorkflow.test.ts";
    expect(source).toContain("candidate-$CONTENT_VERSION.json");
    expect(source).toContain("report-$CONTENT_VERSION.json");
    expect(source).toContain("npm run content:publish -- --version $CONTENT_VERSION");
    expect(source).toContain(focusedTests);
    expect(source).toContain('git add "public/content/system-content-$CONTENT_VERSION.json" app/domain/bundledSystemContent.ts');
    const positions = [
      patternPosition(source, /npm run content:qwen\s+--\s+--version\s+['"]?\$CONTENT_VERSION['"]?/, "remote Qwen generation"),
      ...[...source.matchAll(/\bscp\b[^\r\n]*:(\/opt\/phrase-bank\/\.content-agent\/(?:candidate|report)-\$CONTENT_VERSION\.json)/g)]
        .map((match) => match.index ?? -1)
        .sort((left, right) => left - right),
      commandLine(source, "npm run content:publish -- --version $CONTENT_VERSION"),
      commandLine(source, focusedTests),
      commandLine(source, "npm test"),
      commandLine(source, "npm run lint"),
      commandLine(source, "npm run build"),
      commandLine(source, "git diff --check"),
      commandLine(source, "git fetch origin main"),
      patternPosition(source, /test\s+"\$\(git rev-parse HEAD\)"\s*=\s*"\$\(git rev-parse origin\/main\)"\s*\|\|\s*\{\s*echo\s+"main advanced during Qwen generation";\s*exit\s+1;\s*\}/, "main drift guard"),
      commandLine(source, 'git add "public/content/system-content-$CONTENT_VERSION.json" app/domain/bundledSystemContent.ts'),
      commandLine(source, "git diff --cached --check"),
      commandLine(source, 'git commit -m "content: publish Qwen phrase library $CONTENT_VERSION"'),
      commandLine(source, "git push origin HEAD:main"),
    ];
    positions.slice(1).forEach((position, index) => expect(positions[index]).toBeLessThan(position));
    expect(source).not.toContain("git push --force");
    expect(source).not.toMatch(/\bgit\s+push\b[^\r\n]*--force(?:-with-lease)?(?:\s|$)/);
    expect(source).not.toMatch(/\bgit\s+push\b[^\r\n]*\s-f(?:\s|$)/);
    expect(source).not.toMatch(/\bgit\s+push\b[^\r\n]*\s\+[^\s]+/);
  });

  it("rejects an unsafe server environment and main-branch drift", () => {
    const source = workflow();
    expect(source).toContain("stat -c '%a' /etc/phrase-bank/qwen-content.env");
    expect(source).toContain('test "$env_mode" = "600"');
    expect(source).toContain('test -z "$(git status --porcelain --untracked-files=no)"');
    expect(source).toContain('test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" || { echo "main advanced during Qwen generation"; exit 1; }');
  });
});
