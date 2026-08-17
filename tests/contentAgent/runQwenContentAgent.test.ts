import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { QwenClient } from "../../scripts/content-agent/qwenClient";

const runnerPath = resolve(process.cwd(), "scripts/run-qwen-content-agent.ts");

describe("Qwen content agent runner", () => {
  it("stamps the v2 review provenance in its exported run options", async () => {
    const source = await readFile(runnerPath, "utf8");
    expect(source).toContain('export const QWEN_REVIEW_QUALITY_VERSION = "qwen-plus-review-v2"');

    const runner = await import(`${pathToFileURL(runnerPath).href}?test=${Date.now()}`);
    const client: QwenClient = { complete: vi.fn() };
    const options = runner.createQwenAgentOptions("2026.08.3", client, "2026-08-10T00:00:00.000Z");

    expect(options).toMatchObject({
      client,
      version: "2026.08.3",
      generatedAt: "2026-08-10T00:00:00.000Z",
      qualityVersion: "qwen-plus-review-v2",
    });
  });
});
