import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeStartupSource } from "../../scripts/startupDependencyMetrics";

describe("startup dependency metrics", () => {
  it("counts exportSnapshot in the startup refresh path but excludes an inline Settings export action", () => {
    const root = mkdtempSync(join(tmpdir(), "startup-metrics-")); mkdirSync(join(root, "app"));
    writeFileSync(join(root, "app/PhraseBankApp.tsx"), `
      import { loadHomeData } from "./homeData";
      const refresh = async () => repo.exportSnapshot();
      function Settings() { const exportData = () => repository.exportSnapshot(); return null; }
      export function PhraseBankApp() { useEffect(() => { void refresh(); }, []); return null; }
    `);
    writeFileSync(join(root, "app/homeData.ts"), `export async function loadHomeData(repo) { return repo.listPhrases(); }`);
    expect(analyzeStartupSource(root)).toMatchObject({ exportSnapshotCallSites: 1 });
    expect(analyzeStartupSource(root).callSites[0]).toMatchObject({ file: "app/PhraseBankApp.tsx", functionName: "refresh" });
  });

  it("follows eager startup imports to loadHomeData and ignores dynamic screen imports", () => {
    const root = mkdtempSync(join(tmpdir(), "startup-metrics-")); mkdirSync(join(root, "app"));
    writeFileSync(join(root, "app/PhraseBankApp.tsx"), `import { loadHomeData } from "./homeData"; const Settings=()=>import("./Settings"); export function PhraseBankApp(){ return loadHomeData(repo); }`);
    writeFileSync(join(root, "app/homeData.ts"), `export async function loadHomeData(repo) { return repo.exportSnapshot(); }`);
    writeFileSync(join(root, "app/Settings.tsx"), `export const save = repo => repo.exportSnapshot();`);
    const result = analyzeStartupSource(root);
    expect(result.files).toEqual(["app/PhraseBankApp.tsx", "app/homeData.ts"]);
    expect(result.exportSnapshotCallSites).toBe(1);
  });
});
