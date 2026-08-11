import { describe, expect, it } from "vitest";
import { analyzeHomeBuildManifest } from "./homeBuildPerformance";

describe("home build report parser", () => {
  it("derives hashed chunk roles from manifests instead of fixed filenames", () => {
    const report = analyzeHomeBuildManifest({
      clientAssets: {
        appBootstrapPreinitModules: ["/_next/static/chunks/framework-HASH.js"],
        dynamicPreloads: {
          "app/PhraseBankApp.tsx": ["_next/static/chunks/PhraseBankApp-HASH.js", "_next/static/chunks/framework-HASH.js"],
          "app/components/screens/LibraryScreen.tsx": ["_next/static/chunks/LibraryScreen-HASH.js"],
          "app/components/screens/AddPhraseScreen.tsx": ["_next/static/chunks/AddPhraseScreen-HASH.js"],
          "app/components/screens/SettingsScreen.tsx": ["_next/static/chunks/SettingsScreen-HASH.js"],
          "app/components/screens/ReviewScreen.tsx": ["_next/static/chunks/ReviewScreen-HASH.js"],
          "app/components/screens/PracticeScreen.tsx": ["_next/static/chunks/PracticeScreen-HASH.js"],
          "app/components/screens/LearningScreen.tsx": ["_next/static/chunks/LearningScreen-HASH.js"],
        },
      },
      rscAssets: {
        bootstrapScriptContent: 'import("/_next/static/chunks/index-HASH.js")',
        clientReferenceDeps: {
          home: { js: ["/_next/static/chunks/PhraseBankApp-HASH.js", "/_next/static/chunks/framework-HASH.js"] },
        },
      },
      sizes: {
        "_next/static/chunks/PhraseBankApp-HASH.js": 55_000,
        "_next/static/chunks/framework-HASH.js": 190_000,
        "_next/static/chunks/index-HASH.js": 175_000,
      },
    });

    expect(report.homeChunkBytes).toBe(55_000);
    expect(report.initialFiles).toEqual([
      "_next/static/chunks/PhraseBankApp-HASH.js",
      "_next/static/chunks/framework-HASH.js",
      "_next/static/chunks/index-HASH.js",
    ]);
    expect(report.initialJavaScriptBytes).toBe(420_000);
  });
});
