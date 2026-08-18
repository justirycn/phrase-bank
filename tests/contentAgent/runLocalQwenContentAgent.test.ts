import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QwenClient, QwenClientOptions } from "../../scripts/content-agent/qwenClient";

const runnerPath = resolve(process.cwd(), "scripts/run-local-qwen-content-agent.ts");
const SECRET = "sk-fixture-runner-never-log=value";
const execFileAsync = promisify(execFile);
const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("local Qwen content agent runner", () => {
  it("is safe to import and exposes strict argument parsing", async () => {
    const stdout = vi.spyOn(process.stdout, "write");
    const stderr = vi.spyOn(process.stderr, "write");
    try {
      const runner = await import(`${pathToFileURL(runnerPath).href}?import-safe=${Date.now()}`);
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).not.toHaveBeenCalled();
      expect(runner.parseLocalQwenArguments(["--version", "2026.08.3"])).toEqual({ version: "2026.08.3" });
      expect(runner.parseLocalQwenArguments(["--env-file", "C:/external/qwen.env", "--version", "2026.08.3"])).toEqual({ version: "2026.08.3", envPath: "C:/external/qwen.env" });
      for (const args of [
        [],
        ["--version"],
        ["--version", "--env-file", "outside.env"],
        ["--version", "2026.08.3", "--version", "2026.08.4"],
        ["--version", "2026.08.3", "--env-file", "one.env", "--env-file", "two.env"],
        ["--version", "2026.08.3", "--unknown", "value"],
        ["--version", "../2026.08.3"],
      ]) expect(() => runner.parseLocalQwenArguments(args)).toThrow();
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });

  it("stamps reviewed local options and fixes output under .content-agent", async () => {
    const runner = await import(`${pathToFileURL(runnerPath).href}?options=${Date.now()}`);
    const client: QwenClient = { complete: vi.fn() };
    expect(runner.createLocalAgentOptions("2026.08.3", client, "2026-08-18T00:00:00.000Z")).toMatchObject({
      client,
      version: "2026.08.3",
      generatedAt: "2026-08-18T00:00:00.000Z",
      qualityVersion: "qwen-plus-review-v2",
      outputDir: resolve(".content-agent"),
    });
  });

  it("loads configuration before creating a client and never logs the secret", async () => {
    const runner = await import(`${pathToFileURL(runnerPath).href}?run=${Date.now()}`);
    const calls: string[] = [];
    const output: string[] = [];
    const client: QwenClient = { complete: vi.fn() };
    const createClient = vi.fn((options: QwenClientOptions) => {
      calls.push("client");
      expect(options).toEqual({ apiKey: SECRET, baseUrl: "https://example.invalid/v1", model: "qwen-test", timeoutMs: 120_000 });
      return client;
    });
    const runAgent = vi.fn(async (options: ReturnType<typeof runner.createLocalAgentOptions>) => {
      calls.push("agent");
      expect(options).toMatchObject({ client, qualityVersion: "qwen-plus-review-v2", outputDir: resolve(".content-agent") });
      return { candidatePath: "candidate.json", reportPath: "report.json" };
    });

    const fixturePath = "C:/external/private-qwen.env";
    await runner.runLocalQwenContentAgent(["--version", "2026.08.3", "--env-file", fixturePath], {
      repositoryRoot: process.cwd(),
      loadConfig: vi.fn(async () => {
        calls.push("load");
        return { apiKey: SECRET, baseUrl: "https://example.invalid/v1", model: "qwen-test" };
      }),
      createClient,
      runAgent,
      now: () => new Date("2026-08-18T00:00:00.000Z"),
      writeOutput: (value: string) => output.push(value),
    });

    expect(calls).toEqual(["load", "client", "agent"]);
    expect(output[0]).toBe("Qwen 配置已读取；请确认配置文件仅当前 Windows 用户可读。\n");
    expect(output.join("")).toContain("candidate.json");
    expect(output.join("")).toContain("report.json");
    expect(output.join("")).not.toContain(SECRET);
    expect(output.join("")).not.toContain(fixturePath);
  });

  it("fails on a missing or invalid secret file before client or network creation without leaking contents", async () => {
    const runner = await import(`${pathToFileURL(runnerPath).href}?missing=${Date.now()}`);
    const directory = await mkdtemp(join(tmpdir(), "phrase-bank-local-runner-"));
    temporaryPaths.push(directory);
    const invalidPath = join(directory, "qwen.env");
    await writeFile(invalidPath, `# ${SECRET}\nDASHSCOPE_BASE_URL=https://example.invalid\nDASHSCOPE_MODEL=qwen-test\n`, "utf8");
    const createClient = vi.fn();
    const output: string[] = [];

    let failure = "";
    try {
      await runner.runLocalQwenContentAgent(["--version", "2026.08.3", "--env-file", invalidPath], {
        repositoryRoot: process.cwd(),
        createClient,
        runAgent: vi.fn(),
        writeOutput: (value: string) => output.push(value),
      });
    } catch (error) {
      failure = String(error);
    }

    expect(failure).toMatch(/DASHSCOPE_API_KEY/);
    expect(createClient).not.toHaveBeenCalled();
    expect(`${failure}${output.join("")}`).not.toContain(SECRET);

    const tsxCli = resolve("node_modules/tsx/dist/cli.mjs");
    let captured = "";
    try {
      await execFileAsync(process.execPath, [tsxCli, runnerPath, "--version", "2026.08.3", "--env-file", invalidPath], { cwd: process.cwd() });
    } catch (error) {
      const result = error as { stdout?: string; stderr?: string };
      captured = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    }
    expect(captured).toMatch(/DASHSCOPE_API_KEY/);
    expect(captured).not.toContain(SECRET);
  });
});
