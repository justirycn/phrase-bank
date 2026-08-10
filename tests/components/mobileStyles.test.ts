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

  it("centers answer toolbar icons with their labels", async () => {
    const css = await readFile("app/globals.css", "utf8");
    const rules = [...css.matchAll(/\.answer-tools button\s*\{([^}]*)\}/g)];
    const rule = rules.at(-1)?.[1] ?? "";

    expect(rule).toMatch(/display:flex/);
    expect(rule).toMatch(/align-items:center/);
    expect(rule).toMatch(/justify-content:center/);
    expect(rule).toMatch(/gap:7px/);
    expect(rule).toMatch(/min-height:44px/);
  });

  it("lays out prompt helpers above a full-width primary action", async () => {
    const css = await readFile("app/globals.css", "utf8");
    const helperRule = css.match(/\.prompt-secondary-actions\s*\{([^}]*)\}/)?.[1] ?? "";
    const helperButtonRule = css.match(/\.prompt-secondary-actions button\s*\{([^}]*)\}/)?.[1] ?? "";
    const primaryRule = css.match(/\.self-assessment-action\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(helperRule).toMatch(/display:grid/);
    expect(helperRule).toMatch(/grid-template-columns:repeat\(2,1fr\)/);
    expect(helperButtonRule).toMatch(/display:flex/);
    expect(helperButtonRule).toMatch(/justify-content:center/);
    expect(helperButtonRule).toMatch(/gap:7px/);
    expect(primaryRule).toMatch(/width:100%/);
    expect(primaryRule).toMatch(/background:var\(--forest/);
    expect(primaryRule).toMatch(/color:#fff/);
  });
});
