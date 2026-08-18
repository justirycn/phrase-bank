// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = () => readFileSync(resolve(process.cwd(), ".github/workflows/qwen-content-release.yml"), "utf8");
const deployWorkflow = () => readFileSync(resolve(process.cwd(), ".github/workflows/deploy.yml"), "utf8");
const runbook = () => readFileSync(resolve(process.cwd(), "docs/runbooks/qwen-content-update.md"), "utf8");
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
const lastCommandLine = (source: string, command: string) => {
  const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...source.matchAll(new RegExp(`^[ \\t]*(?:-[ \\t]+)?(?:run:[ \\t]*)?${escaped}[ \\t]*$`, "gm"))];
  expect(matches, `expected workflow command: ${command}`).not.toHaveLength(0);
  return matches.at(-1)?.index ?? -1;
};
const patternPosition = (source: string, pattern: RegExp, description: string) => {
  const match = pattern.exec(source);
  expect(match, `expected ${description}`).not.toBeNull();
  return match?.index ?? -1;
};

describe("Qwen content release workflow", () => {
  it("checks a supplied approved SHA before checkout while preserving push-trigger deploys", () => {
    const source = deployWorkflow();
    expect(source).toContain("approved_sha:");
    expect(source).toContain("github.event_name == 'workflow_dispatch'");
    expect(source).toContain('test -n "$APPROVED_SHA"');
    expect(source).toContain('test "$GITHUB_SHA" = "$APPROVED_SHA"');
    const guard = source.indexOf("name: Verify approved dispatch SHA");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(source.indexOf("actions/checkout@v4"));
    expect(source).toMatch(/push:\r?\n\s+branches: \[main\]/);
  });
  it("deploys the exact event SHA instead of a later main revision", () => {
    const source = deployWorkflow();
    expect(source).toContain("DEPLOY_SHA: ${{ github.sha }}");
    expect(source).toContain('case "$DEPLOY_SHA" in');
    expect(source).toContain('test "${#DEPLOY_SHA}" = 40');
    expect(source).toContain('"DEPLOY_SHA=\'$DEPLOY_SHA\' bash -se"');
    expect(source).not.toContain("git clone");
    expect(source).toContain("git init /opt/phrase-bank");
    expect(source).toContain("git -C /opt/phrase-bank remote add origin https://github.com/justirycn/phrase-bank.git");
    expect(source).toContain("Refusing non-repository deploy directory");
    expect(source).toContain("git fetch --no-tags origin main");
    expect(source).toContain('git cat-file -e "$DEPLOY_SHA^{commit}"');
    expect(source).toContain('git merge-base --is-ancestor "$DEPLOY_SHA" origin/main');
    expect(source).toContain('git checkout --detach "$DEPLOY_SHA"');
    expect(source).not.toContain('git checkout --detach --force');
    expect(source).toContain('test "$(git rev-parse HEAD)" = "$DEPLOY_SHA"');
    expect(source).not.toContain("git pull");
    const order = [
      source.indexOf("git fetch --no-tags origin main"),
      source.indexOf('git cat-file -e "$DEPLOY_SHA^{commit}"'),
      source.indexOf('git merge-base --is-ancestor "$DEPLOY_SHA" origin/main'),
      source.indexOf('git checkout --detach "$DEPLOY_SHA"'),
      source.indexOf('test "$(git rev-parse HEAD)" = "$DEPLOY_SHA"'),
      source.indexOf("docker compose build"),
      source.indexOf("docker compose up -d"),
    ];
    expect(order.every((position) => position >= 0)).toBe(true);
    order.slice(1).forEach((position, index) => expect(order[index]).toBeLessThan(position));
  });
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
    expect(secretExpressions.every((expression) => /^\s*secrets\.(?:TENCENT_HOST|TENCENT_SSH_KEY|TENCENT_USER)\s*$/.test(expression))).toBe(true);
    expect([...new Set(secretNames)].sort()).toEqual(allowedSecrets);

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
    expect(source).not.toContain("git diff --cached --quiet &&");
    expect(source).toMatch(/if git diff --cached --quiet; then\r?\n\s+echo "Qwen content publish produced no changes"\r?\n\s+exit 1\r?\n\s+fi/);
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
      lastCommandLine(normalized, "git fetch origin main"),
      patternPosition(normalized, /test\s+"\$\(git rev-parse HEAD\)"\s*=\s*"\$\(git rev-parse origin\/main\)"\s*\|\|\s*\{\s*echo\s+"main advanced during Qwen generation";\s*exit\s+1;\s*\}/, "main drift guard"),
      commandLine(normalized, 'git add "public/content/system-content-$CONTENT_VERSION.json" app/domain/bundledSystemContent.ts'),
      commandLine(normalized, "git diff --cached --check"),
      commandLine(normalized, 'git commit -m "content: publish Qwen phrase library $CONTENT_VERSION"'),
      commandLine(normalized, 'git push origin "$release_sha:refs/heads/main"'),
    ];
    positions.slice(1).forEach((position, index) => expect(positions[index]).toBeLessThan(position));
    const pushCommands = logicalCommands(normalized).filter((command) => /^git\s+push(?:\s|$)/.test(command));
    expect(pushCommands).toEqual(['git push origin "$release_sha:refs/heads/main"']);
    expect(source).not.toContain("git push --force");
    expect(source).not.toMatch(/\bgit\s+push\b[^\r\n]*--force(?:-with-lease)?(?:\s|$)/);
    expect(source).not.toMatch(/\bgit\s+push\b[^\r\n]*\s-f(?:\s|$)/);
    expect(source).not.toMatch(/\bgit\s+push\b[^\r\n]*\s\+[^\s]+/);
  });

  it("rejects an unsafe server environment and main-branch drift", () => {
    const source = workflow();
    expect(source).toContain("stat -c '%a' /etc/phrase-bank/qwen-content.env");
    expect(source).toContain('test "$env_mode" = "600"');
    expect(source).toContain('test -r /etc/phrase-bank/qwen-content.env');
    expect(source).toContain('test "$(stat -c \'%U\' /etc/phrase-bank/qwen-content.env)" = "$(id -un)"');
    expect(source).toContain('test -z "$(git status --porcelain --untracked-files=no)"');
    expect(source).toContain('test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" || { echo "main advanced during Qwen generation"; exit 1; }');
  });

  it("preflights duplicate content, contains SSH credentials, and dispatches deployment explicitly", () => {
    const source = workflow();
    const normalized = normalizeContinuations(source);
    const pushPosition = commandLine(normalized, 'git push origin "$release_sha:refs/heads/main"');
    const dispatchPosition = commandLine(normalized, 'gh workflow run deploy.yml --ref main -f approved_sha="$RELEASE_SHA"');
    const duplicateGuard = 'test ! -e "public/content/system-content-$CONTENT_VERSION.json" || { echo "Qwen content version $CONTENT_VERSION is already published"; exit 1; }';
    const dependencyInstall = 'docker run --rm -v "$PWD:/workspace" -w /workspace node:22-bookworm-slim sh -lc "npm ci"';
    const qwenGeneration = 'docker run --rm --env-file /etc/phrase-bank/qwen-content.env -v "$PWD:/workspace" -w /workspace node:22-bookworm-slim sh -lc "npm run content:qwen -- --version \'$CONTENT_VERSION\'"';

    expect(source).toContain("actions: write");
    expect(source).toContain("GH_TOKEN: ${{ github.token }}");
    expect(pushPosition).toBeLessThan(dispatchPosition);
    expect(source).toContain("RELEASE_SHA: ${{ steps.publish.outputs.release_sha }}");
    expect(source).toContain('release_sha="$(git rev-parse HEAD)"');
    expect(source).toContain('printf \'release_sha=%s\\n\' "$release_sha" >> "$GITHUB_OUTPUT"');
    expect(source).not.toMatch(/^\s{4}env:\r?\n(?:\s{6}.*\r?\n)*\s{6}TENCENT_/m);
    expect(source).toMatch(/name: Remove SSH key\r?\n\s+if: always\(\)\r?\n\s+run: rm -f ~\/\.ssh\/tencent_qwen/);
    const qualityGates = source.slice(source.indexOf("npm run content:publish"), source.indexOf('git push origin "$release_sha:refs/heads/main"'));
    expect(qualityGates).not.toContain("TENCENT_");
    expect(qualityGates).not.toContain("tencent_qwen");

    const runnerFetch = commandLine(normalized, "git fetch origin main");
    const runnerCheckout = commandLine(normalized, "git checkout --detach origin/main");
    const duplicatePosition = commandLine(normalized, duplicateGuard);
    const installPosition = patternPosition(normalized, /docker run --rm -v "\$PWD:\/workspace" -w \/workspace node:22-bookworm-slim sh -lc "npm ci"/, "dependency install without Qwen credentials");
    const qwenPosition = patternPosition(normalized, /docker run --rm --env-file \/etc\/phrase-bank\/qwen-content\.env -v "\$PWD:\/workspace" -w \/workspace node:22-bookworm-slim sh -lc "npm run content:qwen -- --version '\$CONTENT_VERSION'"/, "Qwen generation with server credentials");
    expect(source).toContain(dependencyInstall);
    expect(source).toContain(qwenGeneration);
    expect(runnerFetch).toBeLessThan(runnerCheckout);
    expect(runnerCheckout).toBeLessThan(duplicatePosition);
    expect(duplicatePosition).toBeLessThan(installPosition);
    expect(installPosition).toBeLessThan(qwenPosition);

    const lockPath = "$HOME/.phrase-bank-operation.lock";
    for (const remoteSource of [source, deployWorkflow()]) {
      expect(remoteSource).toMatch(new RegExp(`exec 9>${lockPath.replace(/[-/\\.^$*+?()[\]{}|]/g, "\\$&")}\\r?\\n\\s+flock 9`));
      expect(remoteSource).not.toContain("/opt/phrase-bank.operation.lock");
    }
    expect(source.indexOf("exec 9>$HOME/.phrase-bank-operation.lock")).toBeLessThan(source.indexOf("cd /opt/phrase-bank"));
    expect(deployWorkflow().indexOf("exec 9>$HOME/.phrase-bank-operation.lock")).toBeLessThan(deployWorkflow().indexOf("git init /opt/phrase-bank"));
    expect(runbook()).toContain('sudo chown "$SSH_USER:$SSH_GROUP" /etc/phrase-bank/qwen-content.env');
    expect(runbook()).toContain("明确触发");
  });
});
