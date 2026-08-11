import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeHomeBuild,
  HOME_BUILD_BUDGETS,
  SCREEN_MODULES,
} from "../support/homeBuildPerformance";

function staticLocalDependencyGraph(entry: string) {
  const root = process.cwd();
  const pending = [resolve(root, entry)];
  const visited = new Set<string>();
  while (pending.length) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["'](\.[^"']+)["']/g)) {
      const base = resolve(dirname(file), match[1]);
      const target = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find(existsSync);
      if (target) pending.push(target);
    }
  }
  return [...visited].map((file) => relative(root, file).replaceAll("\\", "/")).sort();
}

describe("optimized home production contract", () => {
  it("keeps exportSnapshot outside every home-startup dependency", () => {
    const startupModules = staticLocalDependencyGraph("app/PhraseBankApp.tsx");
    expect(startupModules).toEqual(expect.arrayContaining([
      "app/PhraseBankApp.tsx", "app/hooks/useHomeData.ts", "app/services/homeData.ts",
    ]));
    for (const modulePath of startupModules) {
      expect(readFileSync(`${process.cwd()}/${modulePath}`, "utf8"), modulePath).not.toMatch(/\.(?:exportSnapshot)\s*\(/);
    }
    expect(readFileSync(`${process.cwd()}/app/components/screens/SettingsScreen.tsx`, "utf8"))
      .toContain("repository.exportSnapshot()");
    const appCalls = [...startupModules, "app/components/screens/SettingsScreen.tsx"].flatMap((modulePath) => {
      const source = readFileSync(`${process.cwd()}/${modulePath}`, "utf8");
      return [...source.matchAll(/\b(?:repository|repo)\.exportSnapshot\(\)/g)].map(() => modulePath);
    });
    expect(appCalls).toEqual(["app/components/screens/SettingsScreen.tsx"]);
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
