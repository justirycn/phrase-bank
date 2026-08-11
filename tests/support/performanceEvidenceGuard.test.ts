import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { assertCleanAppTree } from "../../scripts/performanceEvidenceGuard";

describe("performance evidence dirty guard", () => {
  it("rejects tracked and untracked app changes before measurement", () => {
    expect(() => assertCleanAppTree(" M app/PhraseBankApp.tsx\n?? app/audit/page.tsx\n"))
      .toThrow("app source tree is dirty");
  });

  it("allows an empty app status", () => {
    expect(() => assertCleanAppTree("\n")).not.toThrow();
  });

  it("runs the app guard before temp creation or metrics writes", () => {
    const source = readFileSync(`${process.cwd()}/scripts/compare-home-performance.ts`, "utf8");
    const guard = source.indexOf("assertCleanAppTree(appStatus)");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(source.indexOf("mkdtempSync("));
    expect(guard).toBeLessThan(source.indexOf("writeFileSync(pendingPath"));
  });
});
