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

  it("shares one speech service across lazy learning and practice without sharing the recorder", () => {
    const learning = readFileSync(`${process.cwd()}/app/components/screens/LearningScreen.tsx`, "utf8");
    const practice = readFileSync(`${process.cwd()}/app/components/screens/PracticeScreen.tsx`, "utf8");
    const sharedSpeech = readFileSync(`${process.cwd()}/app/components/screens/screenSpeech.ts`, "utf8");

    expect(learning).toContain('from "./screenSpeech"');
    expect(practice).toContain('from "./screenSpeech"');
    expect(learning).not.toContain("new BrowserSpeechService");
    expect(practice).not.toContain("new BrowserSpeechService");
    expect(sharedSpeech.match(/new BrowserSpeechService/g)).toHaveLength(1);
    expect(learning).not.toContain("TemporaryRecorder");
    expect(practice).toContain("new TemporaryRecorder");
  });
});
