import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("reproducible home before/after evidence", () => {
  it("records a verified baseline and current build with cleanup", () => {
    const metrics = JSON.parse(readFileSync(`${process.cwd()}/docs/audits/home-heatmap-performance/metrics.json`, "utf8"));
    const comparison = metrics.beforeAfter;
    expect(comparison.command).toBe("npm run benchmark:home-before-after");
    expect(comparison.baseline.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(comparison.baseline.sha.startsWith("aa717301")).toBe(true);
    for (const side of [comparison.baseline, comparison.current]) {
      expect(side.build.htmlBytes).toBeGreaterThan(0);
      expect(side.build.initialJavaScriptBytes).toBeGreaterThan(0);
      expect(side.build.homeChunkBytes).toBeGreaterThan(0);
    }
    expect(comparison.current.homeDataBenchmark.fixture.phrases).toBe(2000);
    expect(comparison.current.homeDataBenchmark.calls.exportSnapshot).toBe(0);
    expect(comparison.baseline.startupSource.exportSnapshotCallSites).toBe(1);
    expect(comparison.current.startupSource.exportSnapshotCallSites).toBe(0);
    expect(comparison.baseline.homeDataBenchmark.available).toBe(false);
    expect(comparison.cleanup.tempDirectoryRemoved).toBe(true);
    expect(comparison.cleanup.worktreeRegistrationCreated).toBe(false);
    expect(comparison.cleanup.verifiedResidueCount).toBe(0);
    expect(metrics.build.before.homeChunkBytes).toBe(comparison.baseline.build.homeChunkBytes);
    expect(metrics.build.current.homeChunkBytes).toBe(comparison.current.build.homeChunkBytes);
    expect(metrics.homeDataBenchmark.rows).toEqual(comparison.current.homeDataBenchmark.rows);
  });
});
