import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("non-home screen chunk contract", () => {
  it("uses one dynamic module specifier per non-home screen and no monolithic screen import", () => {
    const source = readFileSync(`${process.cwd()}/app/PhraseBankApp.tsx`, "utf8");
    const specifiers = [
      "./components/screens/LibraryScreen",
      "./components/screens/AddPhraseScreen",
      "./components/screens/SettingsScreen",
      "./components/screens/ReviewScreen",
      "./components/screens/PracticeScreen",
      "./components/screens/LearningScreen",
    ];

    for (const specifier of specifiers) expect(source).toContain('import("' + specifier + '")');
    expect(new Set(specifiers).size).toBe(6);
    expect(source).not.toContain("NonHomeScreens");
  });
});
