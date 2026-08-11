import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("fresh build performance gate isolation", () => {
  it("never enables build artifact assertions from stale dist existence", () => {
    const source = readFileSync(`${process.cwd()}/tests/deployment/homePerformance.test.ts`, "utf8");
    expect(source).toContain('process.env.HOME_PERFORMANCE_BUILD === "1"');
    expect(source).not.toContain("describe.runIf(existsSync");
  });

  it("dedicated performance command builds before its env-gated test runner", () => {
    const pkg = JSON.parse(readFileSync(`${process.cwd()}/package.json`, "utf8"));
    expect(pkg.scripts["test:home-performance"]).toBe("npm run build && tsx scripts/run-home-performance-tests.ts");
  });
});
