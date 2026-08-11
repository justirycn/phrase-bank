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

describe("iPhone new phrase learning styles", () => {
  it("reserves the learning action tray and bottom safe area", async () => {
    const css = await readFile("app/globals.css", "utf8");

    expect(css).toMatch(/\.new-phrase-learning\s*\{[^}]*padding-bottom:\s*calc\(196px \+ env\(safe-area-inset-bottom\)\)/s);
    expect(css).toMatch(/\.new-learning-actions\s*\{[^}]*padding:[^;}]*calc\(16px \+ env\(safe-area-inset-bottom\)\)/s);
  });

  it("keeps learning controls comfortably tappable without iOS input zoom", async () => {
    const css = await readFile("app/globals.css", "utf8");

    expect(css).toMatch(/\.new-learning-close\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/s);
    expect(css).toMatch(/\.new-learning-actions button\s*\{[^}]*min-height:\s*56px/s);
    expect(css).toMatch(/\.new-learning-state-actions button[^}]*min-height:\s*44px/s);
    expect(css).toMatch(/input,\s*textarea,\s*select\s*\{[^}]*font-size:\s*16px/s);
  });

  it("wraps long learning copy at every flex and grid boundary", async () => {
    const css = await readFile("app/globals.css", "utf8");
    const english = css.match(/\.new-learning-english\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(english).toMatch(/white-space:\s*normal/);
    expect(english).toMatch(/overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/\.new-learning-card,\s*\.new-learning-answer[^}]*min-width:\s*0/s);
    expect(css).toMatch(/\.new-learning-chinese,[^}]*overflow-wrap:\s*anywhere/s);
  });

  it("stacks all three home entries cleanly on the iPhone width", async () => {
    const css = await readFile("app/globals.css", "utf8");
    expect(css).toMatch(/@media\s*\(max-width:\s*390px\)\s*\{[\s\S]*?\.training-entry\s*\{[^}]*grid-template-columns:\s*1fr[\s\S]*?\.training-entry button\s*\{[^}]*width:\s*100%/);
    expect(css).toMatch(/\.learning-start\s*\{[^}]*min-height:\s*88px/s);
    expect(css).toMatch(/\.training-entry button > span\s*\{[^}]*min-width:\s*0/s);
  });

  it("removes learning motion when reduced motion is requested", async () => {
    const css = await readFile("app/globals.css", "utf8");

    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.new-phrase-learning[^}]*animation:\s*none/s);
  });
});
