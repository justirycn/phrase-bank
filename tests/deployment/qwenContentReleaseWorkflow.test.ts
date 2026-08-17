// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = () => readFileSync(resolve(process.cwd(), ".github/workflows/qwen-content-release.yml"), "utf8");
const normalizeContinuations = (source: string) => source.replace(/\\[ \t]*\r?\n[ \t]*/g, " ");
const logicalCommands = (source: string) => normalizeContinuations(source)
  .split(/\r?\n/)
  .map((line) => line.trim().replace(/^(?:-\s*)?run:\s*(?:\|\s*)?/, "").trim().replace(/\s+/g, " "))
  .filter((line) => line.length > 0 && line !== "|" && !line.startsWith("#"));
const expectedScpCommands = [
  'scp -i ~/.ssh/tencent_qwen -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes "$TENCENT_USER@$TENCENT_HOST:/opt/phrase-bank/.content-agent/candidate-$CONTENT_VERSION.json" ".content-agent/candidate-$CONTENT_VERSION.json"',
  'scp -i ~/.ssh/tencent_qwen -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes "$TENCENT_USER@$TENCENT_HOST:/opt/phrase-bank/.content-agent/report-$CONTENT_VERSION.json" ".content-agent/report-$CONTENT_VERSION.json"',
];
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

    const secretExpressions = [...source.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].map((match) => match[1]).filter((expression) => /\bsecrets\b/.test(expression));
    const allowedSecrets = ["TENCENT_HOST", "TENCENT_SSH_KEY", "TENCENT_USER"];
    const secretNames = secretExpressions.flatMap((expression) => [...expression.matchAll(/\bsecrets\.([A-Za-z0-9_]+)\b/g)].map((match) => match[1]));
    expect(secretExpressions).toHaveLength(3);
    expect(secretExpressions.every((expression) => /^\s*secrets\.(?:TENCENT_HOST|TENCENT_SSH_KEY|TENCENT_USER)\s*$/.test(expression))).toBe(true);
    expect(secretNames.sort()).toEqual(allowedSecrets);

    const normalized = normalizeContinuations(source);
    const scpCommands = logicalCommands(normalized).filter((command) => /^scp(?:\s|$)/.test(command));
    expect(scpCommands).toEqual(expectedScpCommands);
    const remoteSourcePaths = scpCommands.flatMap((command) => {
      const paths = [...command.matchAll(/:(\/opt\/phrase-bank\/\.content-agent\/(?:candidate|report)-\$CONTENT_VERSION\.json)(?=["'\s]|$)/g)].map((match) => match[1]);
      expect(paths).toHaveLength(1);
      return paths;
    });
    expect(remoteSourcePaths.sort()).toEqual([
      "/opt/phrase-bank/.content-agent/candidate-$CONTENT_VERSION.json",
      "/opt/phrase-bank/.content-agent/report-$CONTENT_VERSION.json",
    ]);
    expect(scpCommands.some((command) => /(?:^|\s)(?:--recursive|-[A-Za-z]*r[A-Za-z]*)(?=\s|$)/.test(command))).toBe(false);
    expect(normalized).not.toMatch(/\b(?:scp|cp)\b[^\r\n]*(?:\/etc\/phrase-bank|qwen-content\.env)/);
  });

  it("validates before committing and never force-pushes", () => {
    const source = workflow();
    const normalized = normalizeContinuations(source);
    const focusedTests = "npm test -- tests/contentAgent tests/deployment/qwenSecrets.test.ts tests/deployment/qwenContentReleaseWorkflow.test.ts";
    expect(source).toContain("candidate-$CONTENT_VERSION.json");
    expect(source).toContain("report-$CONTENT_VERSION.json");
    expect(source).toContain("npm run content:publish -- --version $CONTENT_VERSION");
    expect(source).toContain(focusedTests);
    expect(source).toContain('git add "public/content/system-content-$CONTENT_VERSION.json" app/domain/bundledSystemContent.ts');
    const scpArtifactPositions = [...normalized.matchAll(/(?:^|\n)[ \t]*(?:-[ \t]+)?(?:run:[ \t]*)?scp\b[^\r\n]*:(\/opt\/phrase-bank\/\.content-agent\/(?:candidate|report)-\$CONTENT_VERSION\.json)/g)]
      .map((match) => match.index ?? -1)
      .sort((left, right) => left - right);
    const positions = [
      patternPosition(normalized, /npm run content:qwen\s+--\s+--version\s+['"]?\$CONTENT_VERSION['"]?/, "remote Qwen generation"),
      ...scpArtifactPositions,
      commandLine(normalized, "npm run content:publish -- --version $CONTENT_VERSION"),
      commandLine(normalized, focusedTests),
      commandLine(normalized, "npm test"),
      commandLine(normalized, "npm run lint"),
      commandLine(normalized, "npm run build"),
      commandLine(normalized, "git diff --check"),
      commandLine(normalized, "git fetch origin main"),
      patternPosition(normalized, /test\s+"\$\(git rev-parse HEAD\)"\s*=\s*"\$\(git rev-parse origin\/main\)"\s*\|\|\s*\{\s*echo\s+"main advanced during Qwen generation";\s*exit\s+1;\s*\}/, "main drift guard"),
      commandLine(normalized, 'git add "public/content/system-content-$CONTENT_VERSION.json" app/domain/bundledSystemContent.ts'),
      commandLine(normalized, "git diff --cached --check"),
      commandLine(normalized, 'git commit -m "content: publish Qwen phrase library $CONTENT_VERSION"'),
      commandLine(normalized, "git push origin HEAD:main"),
    ];
    positions.slice(1).forEach((position, index) => expect(positions[index]).toBeLessThan(position));
    const pushCommands = logicalCommands(normalized).filter((command) => /^git\s+push(?:\s|$)/.test(command));
    expect(pushCommands).toEqual(["git push origin HEAD:main"]);
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
