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
        "_next/static/chunks/LibraryScreen-HASH.js": 1_000,
        "_next/static/chunks/AddPhraseScreen-HASH.js": 1_000,
        "_next/static/chunks/SettingsScreen-HASH.js": 1_000,
        "_next/static/chunks/ReviewScreen-HASH.js": 1_000,
        "_next/static/chunks/PracticeScreen-HASH.js": 1_000,
        "_next/static/chunks/LearningScreen-HASH.js": 1_000,
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

  it("rejects a manifest that references a missing initial asset", () => {
    expect(() => analyzeHomeBuildManifest({
      clientAssets: {
        dynamicPreloads: Object.fromEntries([
          ["app/PhraseBankApp.tsx", ["_next/static/chunks/PhraseBankApp-HASH.js"]],
          ...["Library", "AddPhrase", "Settings", "Review", "Practice", "Learning"].map((name) =>
            [`app/components/screens/${name}Screen.tsx`, [`_next/static/chunks/${name}Screen-HASH.js`]],
          ),
        ]),
      },
      rscAssets: {
        bootstrapScriptContent: 'import("/_next/static/chunks/missing-bootstrap.js")',
        clientReferenceDeps: { home: { js: ["/_next/static/chunks/PhraseBankApp-HASH.js"] } },
      },
      sizes: { "_next/static/chunks/PhraseBankApp-HASH.js": 55_000 },
    })).toThrow(/missing-bootstrap/);
  });

  it("rejects a missing referenced home chunk", () => {
    const screens = ["Library", "AddPhrase", "Settings", "Review", "Practice", "Learning"];
    expect(() => analyzeHomeBuildManifest({
      clientAssets: {
        dynamicPreloads: Object.fromEntries([
          ["app/PhraseBankApp.tsx", ["_next/static/chunks/PhraseBankApp-MISSING.js"]],
          ...screens.map((name) => [`app/components/screens/${name}Screen.tsx`, [`_next/static/chunks/${name}Screen-HASH.js`]]),
        ]),
      },
      rscAssets: { clientReferenceDeps: { home: { js: ["/_next/static/chunks/PhraseBankApp-MISSING.js"] } } },
      sizes: Object.fromEntries(screens.map((name) => [`_next/static/chunks/${name}Screen-HASH.js`, 1_000])),
    })).toThrow(/PhraseBankApp-MISSING/);
  });

  it("rejects a referenced screen chunk missing from the client output", () => {
    const screens = ["Library", "AddPhrase", "Settings", "Review", "Practice", "Learning"];
    const sizes = Object.fromEntries([
      ["_next/static/chunks/PhraseBankApp-HASH.js", 55_000],
      ...screens.filter((name) => name !== "Practice").map((name) => [`_next/static/chunks/${name}Screen-HASH.js`, 1_000]),
    ]);
    expect(() => analyzeHomeBuildManifest({
      clientAssets: { dynamicPreloads: Object.fromEntries([
        ["app/PhraseBankApp.tsx", ["_next/static/chunks/PhraseBankApp-HASH.js"]],
        ...screens.map((name) => [`app/components/screens/${name}Screen.tsx`, [`_next/static/chunks/${name}Screen-HASH.js`]]),
      ]) },
      rscAssets: { clientReferenceDeps: { home: { js: ["/_next/static/chunks/PhraseBankApp-HASH.js"] } } },
      sizes,
    })).toThrow(/PracticeScreen-HASH/);
  });
});
