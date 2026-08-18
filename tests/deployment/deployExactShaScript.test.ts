// @vitest-environment node
import { chmod, link, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

const sha = "a".repeat(40);
const script = resolve(".github/scripts/deploy-exact-sha.sh");
const bashExecutable = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "bash.exe") : "bash";
const bashPath = (path: string) => process.platform === "win32"
  ? path.replace(/^([A-Za-z]):\\/u, (_, drive: string) => `/mnt/${drive.toLowerCase()}/`).replaceAll("\\", "/")
  : path;

async function fixture(statuses: number[]) {
  const root = await mkdtemp(join(tmpdir(), "deploy-exact-sha-"));
  const home = join(root, "home");
  const repository = join(root, "repository");
  const bin = join(root, "bin");
  const log = join(root, "operations.log");
  const statusFile = join(root, "curl-statuses");
  await Promise.all([mkdir(home), mkdir(join(repository, ".git"), { recursive: true }), mkdir(bin)]);
  await writeFile(log, "");
  await writeFile(statusFile, `${statuses.join("\n")}\n`);
  const stubs: Record<string, string> = {
    git: `#!/usr/bin/env bash
set -eu
printf 'git %s\\n' "$*" >> "$STUB_LOG"
if [ "\${1:-}" = status ]; then exit 0; fi
if [ "\${1:-}" = rev-parse ] && [ "\${2:-}" = HEAD ]; then printf '%s\\n' "$DEPLOY_SHA"; fi
`,
    docker: `#!/usr/bin/env bash
set -eu
printf 'docker %s\\n' "$*" >> "$STUB_LOG"
`,
    curl: `#!/usr/bin/env bash
set -eu
status=$(head -n 1 "$STATUS_FILE")
if [ -z "$status" ]; then status=500; fi
tail -n +2 "$STATUS_FILE" > "$STATUS_FILE.next"
mv "$STATUS_FILE.next" "$STATUS_FILE"
printf 'curl %s\\n' "$status" >> "$STUB_LOG"
printf '%s' "$status"
`,
  };
  for (const [name, contents] of Object.entries(stubs)) {
    const path = join(bin, name);
    await writeFile(path, contents);
    await chmod(path, 0o755);
  }
  return { root, home, repository, bin, log, statusFile, marker: join(home, ".phrase-bank-deployed-sha") };
}

async function execute(files: Awaited<ReturnType<typeof fixture>>) {
  const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
  const command = [
    `export DEPLOY_SHA=${quote(sha)}`,
    `export HOME=${quote(bashPath(files.home))}`,
    `export PATH=${quote(`${bashPath(files.bin)}:/usr/bin:/bin`)}`,
    `export STATUS_FILE=${quote(bashPath(files.statusFile))}`,
    `export STUB_LOG=${quote(bashPath(files.log))}`,
    `exec bash ${quote(bashPath(script))} ${quote(bashPath(files.repository))} 1 0`,
  ].join("; ");
  return await new Promise<{ code: number | null; stdout: string; stderr: string }>((done, reject) => {
    const child = spawn(bashExecutable, ["-c", command], { env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => done({ code, stdout, stderr }));
  });
}

describe("exact SHA remote deployment script", () => {
  it("writes the marker only after the first deployment becomes healthy", async () => {
    const files = await fixture([200, 200]);
    const result = await execute(files);
    expect(result.code, JSON.stringify(result)).toBe(0);
    expect(await readFile(files.marker, "utf8")).toBe(`${sha}\n`);
    expect(await readFile(files.log, "utf8")).toMatch(/docker compose build[\s\S]*docker compose up -d[\s\S]*curl 200[\s\S]*curl 200/u);
  });

  it("skips every Docker mutation when the same SHA marker is healthy", async () => {
    const files = await fixture([200, 200]);
    await writeFile(files.marker, `${sha}\n`, { mode: 0o600 });
    const result = await execute(files);
    expect(result).toMatchObject({ code: 0 });
    expect(await readFile(files.log, "utf8")).not.toContain("docker ");
  });

  it("rebuilds the same SHA when its existing deployment is unhealthy", async () => {
    const files = await fixture([500, 500, 200, 200]);
    await writeFile(files.marker, `${sha}\n`, { mode: 0o600 });
    const result = await execute(files);
    expect(result).toMatchObject({ code: 0 });
    expect(await readFile(files.log, "utf8")).toContain("docker compose up -d");
    expect(await readFile(files.marker, "utf8")).toBe(`${sha}\n`);
  });

  it("does not create a marker when post-deploy health fails", async () => {
    const files = await fixture([500, 500]);
    const result = await execute(files);
    expect(result.code).not.toBe(0);
    await expect(readFile(files.marker, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects directory, symbolic-link, hard-linked, and malformed markers", async () => {
    for (const kind of ["directory", "symlink", "hardlink", "malformed"] as const) {
      const files = await fixture([200, 200]);
      if (kind === "directory") await mkdir(files.marker);
      if (kind === "symlink") {
        const target = join(files.home, "target");
        await writeFile(target, `${sha}\n`);
        await symlink(target, files.marker);
      }
      if (kind === "hardlink") {
        const target = join(files.home, "target");
        await writeFile(target, `${sha}\n`);
        await link(target, files.marker);
      }
      if (kind === "malformed") await writeFile(files.marker, "not-a-sha\n");
      const result = await execute(files);
      expect(result.code, `${kind}: ${result.stderr}`).not.toBe(0);
      expect(await readFile(files.log, "utf8")).not.toContain("docker ");
    }
  });
});
