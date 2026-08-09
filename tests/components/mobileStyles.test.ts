import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("mobile phrase typography", () => {
  it("keeps long English phrases wrappable without clipping", async () => {
    const css = await readFile("app/globals.css", "utf8");
    const rule = css.match(/\.phrase-english\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(rule).toMatch(/white-space:\s*normal\s*;/);
    expect(rule).toMatch(/overflow-wrap:\s*anywhere\s*;/);
  });

  it("reserves enough iPhone-height clearance for the fixed answer tray", async () => {
    const css = await readFile("app/globals.css", "utf8");
    expect(css).toMatch(/\.speaking-practice\.phase-answer\s*\{[^}]*padding-bottom:calc\(220px \+ env\(safe-area-inset-bottom\)\)/);
    expect(css).toMatch(/\.speaking-practice\.has-microphone-fallback\s*\{[^}]*padding-bottom:calc\(250px \+ env\(safe-area-inset-bottom\)\)/);
    expect(css).toMatch(/\.practice-actions button[^}]*min-height:44px/);
    expect(css).toMatch(/overflow-wrap:anywhere/);
  });
});
