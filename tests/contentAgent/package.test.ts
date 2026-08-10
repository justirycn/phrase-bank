import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { generateSystemContent } from "../../scripts/content-agent/generator";
import { inspectSystemContent } from "../../scripts/content-agent/qualityGate";

const artifact = resolve(process.cwd(), "public/content/system-content-2026.08.1.json");

describe("published system content package", () => {
  it("matches deterministic generation and passes the independent quality gate", () => {
    const raw = readFileSync(artifact, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual(generateSystemContent());
    expect(inspectSystemContent(parsed).errors).toEqual([]);
    expect(raw).toBe(`${JSON.stringify(generateSystemContent(), null, 2)}\n`);
  });
});
