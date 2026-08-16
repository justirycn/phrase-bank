import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readCurrentAppTree } from "../../scripts/gitEvidence";

describe("reproducible home before/after evidence", () => {
  it("resolves build dependencies from the installed runtime instead of the worktree", () => {
    const runner = readFileSync(`${process.cwd()}/scripts/compare-home-performance.ts`, "utf8");
    expect(runner).toContain('import.meta.resolve("vinext")');
    expect(runner).toContain("symlinkSync(dependencyRoot");
    expect(runner).not.toContain('join(projectRoot, "node_modules/vinext/dist/cli.js")');
    expect(runner).not.toContain('symlinkSync(join(projectRoot, "node_modules")');
  });

  it("records a verified baseline and current build with cleanup", () => {
    const metrics = JSON.parse(readFileSync(`${process.cwd()}/docs/audits/home-heatmap-performance/metrics.json`, "utf8"));
    const comparison = metrics.beforeAfter;
    expect(comparison.command).toBe("npm run benchmark:home-before-after");
    expect(comparison.baseline.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(comparison.baseline.sha.startsWith("3e20260")).toBe(true);
    for (const side of [comparison.baseline, comparison.current]) {
      expect(side.build.htmlBytes).toBeGreaterThan(0);
      expect(side.build.initialJavaScriptBytes).toBeGreaterThan(0);
      expect(side.build.homeChunkBytes).toBeGreaterThan(0);
    }
    expect(comparison.current.homeDataBenchmark.fixture.phrases).toBe(2000);
    expect(comparison.current.homeDataBenchmark.calls.exportSnapshot).toBe(0);
    expect(comparison.baseline.startupSource.exportSnapshotCallSites).toBe(1);
    expect(comparison.baseline.startupSource.callSites).toEqual([
      expect.objectContaining({ file: "app/PhraseBankApp.tsx", functionName: "refresh" }),
    ]);
    expect(comparison.baseline.startupSource.note).toContain("startup dependency graph");
    expect(comparison.current.startupSource.exportSnapshotCallSites).toBe(0);
    expect(comparison.baseline.homeDataBenchmark.available).toBe(false);
    expect(comparison.cleanup.tempDirectoryRemoved).toBe(true);
    expect(comparison.cleanup.worktreeRegistrationCreated).toBe(false);
    expect(comparison.cleanup.verifiedResidueCount).toBe(0);
    expect(comparison.generatedByRunner).toBe(true);
    const currentAppTree = readCurrentAppTree(process.cwd());
    if (currentAppTree) expect(comparison.current.sourceTree).toBe(currentAppTree);
    else expect(comparison.current.sourceTree).toMatch(/^[0-9a-f]{40}$/);
    expect(comparison.baseline.sourceTree).toMatch(/^[0-9a-f]{40}$/);
    expect(metrics.build.before.homeChunkBytes).toBe(comparison.baseline.build.homeChunkBytes);
    expect(metrics.build.current.homeChunkBytes).toBe(comparison.current.build.homeChunkBytes);
    expect(metrics.homeDataBenchmark.rows).toEqual(comparison.current.homeDataBenchmark.rows);
    const readme = readFileSync(`${process.cwd()}/docs/audits/home-heatmap-performance/README.md`, "utf8");
    expect(readme).toContain(comparison.current.sourceTree);
    expect(readme).toContain(comparison.baseline.sha);
    expect(readme).toContain("startup dependency graph");
    expect(readme).toContain("evidence commit");
    expect(readme).toContain("current.sha");
  });
});
