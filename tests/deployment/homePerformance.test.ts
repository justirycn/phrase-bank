import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  analyzeHomeBuild,
  HOME_BUILD_BUDGETS,
  SCREEN_MODULES,
} from "../support/homeBuildPerformance";

describe("optimized home production contract", () => {
  it("does not export a full backup while starting the home screen", () => {
    const source = readFileSync(`${process.cwd()}/app/PhraseBankApp.tsx`, "utf8");
    expect(source).not.toContain("exportSnapshot(");
  });

});

describe.runIf(existsSync(`${process.cwd()}/dist/server/vinext-client-assets.js`))("optimized production build budgets", () => {
  it("keeps all six non-home screens in distinct dynamic production chunks", () => {
    const report = analyzeHomeBuild(process.cwd());

    expect(Object.keys(report.screenChunks).sort()).toEqual([...SCREEN_MODULES].sort());
    expect(new Set(Object.values(report.screenChunks))).toHaveLength(6);
    for (const file of Object.values(report.screenChunks)) {
      expect(report.initialFiles).not.toContain(file);
    }
  });

  it("keeps the home coordinator and initial JavaScript within maintainable budgets", () => {
    const report = analyzeHomeBuild(process.cwd());

    expect(report.homeChunkBytes).toBeLessThanOrEqual(HOME_BUILD_BUDGETS.homeChunkBytes);
    expect(report.initialJavaScriptBytes).toBeLessThanOrEqual(HOME_BUILD_BUDGETS.initialJavaScriptBytes);
  });
});
