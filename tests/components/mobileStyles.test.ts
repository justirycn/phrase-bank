import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

function contrastRatio(foreground: string, background: string) {
  const luminance = (hex: string) => {
    const channels = hex.slice(1).match(/.{2}/g)?.map((channel) => Number.parseInt(channel, 16) / 255) ?? [];
    const [red, green, blue] = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function ruleSelectors(css: string) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors: string[] = [];
  let segmentStart = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") {
      const candidate = source.slice(segmentStart, index).trim();
      if (candidate && !candidate.startsWith("@")) selectors.push(...candidate.split(",").map((selector) => selector.trim()));
      segmentStart = index + 1;
    } else if (character === ";" || character === "}") {
      segmentStart = index + 1;
    }
  }
  return selectors;
}

describe("mobile phrase typography", () => {
  it("fits the complete 12-week heatmap without horizontal overflow", async () => {
    const css = await readFile("app/globals.css", "utf8");
    const grid = css.match(/\.heatmap-grid\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(grid).toMatch(/grid-template-columns:\s*repeat\(12,minmax\(0,1fr\)\)/);
    expect(grid).toMatch(/grid-template-rows:\s*repeat\(7,minmax\(0,1fr\)\)/);
    expect(grid).toMatch(/grid-auto-flow:\s*column/);
    expect(grid).toMatch(/width:\s*100%/);
    expect(grid).toMatch(/max-width:\s*100%/);
    expect(grid).toMatch(/min-width:\s*0/);
    expect(grid).toMatch(/overflow:\s*hidden/);
    expect(css).toMatch(/\.learning-heatmap[^}]*min-width:\s*0/);
    expect(css).toMatch(/@media\s*\(max-width:\s*430px\)[\s\S]*?\.learning-heatmap/);
    expect(css).toMatch(/@media\s*\(max-width:\s*390px\)[\s\S]*?\.heatmap-grid/);
  });

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
  it("separates live learning and review controls with warm and cool task accents", async () => {
    const css = await readFile("app/globals.css", "utf8");
    const learningMode = css.match(/\.new-phrase-learning \.task-mode-learning\s*\{([^}]*)\}/s)?.[1] ?? "";
    const reviewMode = css.match(/\.speaking-practice \.task-mode-review\s*\{([^}]*)\}/s)?.[1] ?? "";

    expect(css).toMatch(/\.new-phrase-learning\s*\{[^}]*--task-accent:\s*#d86b4b[^}]*--task-accent-strong:\s*#a4472d[^}]*--task-surface:\s*#[0-9a-f]{6}[^}]*background:\s*var\(--task-surface\)/s);
    expect(css).toMatch(/\.speaking-practice\s*\{[^}]*--task-accent:\s*#267453[^}]*--task-surface:\s*#[0-9a-f]{6}[^}]*background:\s*var\(--task-surface\)/s);
    for (const mode of [learningMode, reviewMode]) {
      expect(mode).toMatch(/display:\s*inline-flex/);
      expect(mode).toMatch(/border-radius:\s*999px/);
      expect(mode).toMatch(/white-space:\s*nowrap/);
      expect(mode).toMatch(/background:/);
    }
    expect(css).toMatch(/\.new-phrase-learning \.new-learning-actions \.primary\s*\{[^}]*background:\s*var\(--task-accent-strong,\s*#a4472d\)[^}]*color:\s*#fff/s);
    expect(css).toMatch(/\.new-phrase-learning \.learning-track i\s*\{[^}]*background:\s*var\(--task-accent-strong,\s*#a4472d\)/s);
    expect(css).toMatch(/\.new-phrase-learning \.task-mode-learning\s*\{[^}]*background:\s*#f9ddd3[^}]*color:\s*var\(--task-accent-strong,\s*#a4472d\)/s);
    expect(css).toMatch(/\.new-phrase-learning \.new-learning-grades button:last-child\s*\{[^}]*background:\s*var\(--task-accent-strong,\s*#a4472d\)[^}]*color:\s*#fff/s);
    expect(css).toMatch(/\.speaking-practice \.practice-track i\s*\{[^}]*background:\s*var\(--task-accent\)/s);
    expect(css).toMatch(/\.speaking-practice \.self-assessment-action\s*\{[^}]*background:\s*var\(--task-accent\)/s);
    expect(css).toMatch(/\.speaking-practice \.review-hidden-answer\s*\{[^}]*border:\s*[^;}]*dashed[^}]*text-align:\s*center/s);
    expect(css).not.toMatch(/\.speaking-practice \.practice-prompt > p:not\(\.eyebrow\)/);
    expect(contrastRatio("#ffffff", "#a4472d")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#a4472d", "#f9ddd3")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#a4472d", "#fce4dc")).toBeGreaterThanOrEqual(3);
  });

  it("does not restore removed quick-practice styling", async () => {
    const css = await readFile("app/globals.css", "utf8");
    const selectors = ruleSelectors(`${css}\n/* .quick-start is intentionally unsupported. */`);

    expect(selectors.some((selector) => selector.includes(".quick-start"))).toBe(false);
  });

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

  it("stacks both independent home entries cleanly on the iPhone width", async () => {
    const css = await readFile("app/globals.css", "utf8");
    expect(css).toMatch(/\.training-entry\s*\{[^}]*grid-template-columns:\s*1fr/);
    expect(css).toMatch(/\.training-entry button\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0[^}]*overflow-wrap:\s*anywhere/s);
    expect(css).toMatch(/\.training-entry button > span\s*\{[^}]*min-width:\s*0/s);
    expect(css).toMatch(/\.continue-start\s*\{[^}]*background:\s*#267453/s);
    expect(css).toMatch(/\.learning-start\s*\{[^}]*min-height:\s*88px/s);
    expect(ruleSelectors(css).some((selector) => selector.includes(".standard-start"))).toBe(false);
    expect(css).toMatch(/\.weekly-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,1fr\)/s);
    expect(css).toMatch(/\.weekly-grid p\s*\{[^}]*min-width:\s*0/s);
  });

  it("removes learning motion when reduced motion is requested", async () => {
    const css = await readFile("app/globals.css", "utf8");

    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\*\s*\{[^}]*animation:\s*none\s*!important/s);
  });

  it("stacks the tallest revealed tray in a 200 percent equivalent container", async () => {
    const css = await readFile("app/globals.css", "utf8");

    expect(css).toMatch(/\.new-phrase-learning\s*\{[^}]*container-type:\s*inline-size/s);
    expect(css).toMatch(/\.app-main:has\(> \.new-phrase-learning\)\s*\{[^}]*container-type:\s*inline-size/s);
    expect(css).toMatch(/@container\s*\(max-width:\s*240px\)\s*\{[\s\S]*?\.new-learning-grades\s*\{[^}]*grid-template-columns:\s*1fr/s);
    expect(css).toMatch(/@container\s*\(max-width:\s*240px\)[\s\S]*?\.new-phrase-learning\.phase-test\s*\{[^}]*padding-bottom:\s*calc\(420px \+ env\(safe-area-inset-bottom\)\)/s);
    expect(css).toMatch(/@container\s*\(max-width:\s*240px\)[\s\S]*?\.new-learning-actions\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0/s);
    expect(css).toMatch(/@container\s*\(max-width:\s*240px\)[\s\S]*?\.new-learning-actions button\s*\{[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*anywhere/s);
  });
});

describe("checked-in iPhone learning audit artifact integrity", () => {
  const auditDirectory = "docs/audits/iphone13pro-learning";

  it("keeps exactly eight genuine 390 by 844 PNG captures", async () => {
    const expected = ["01-home.png", "02-study.png", "03-fifth.png", "04-hidden.png", "05-revealed.png", "06-error.png", "07-complete.png", "08-library.png"];
    const actual = (await readdir(auditDirectory)).filter((name) => name.endsWith(".png")).sort();
    expect(actual).toEqual(expected);

    for (const name of actual) {
      const image = await readFile(`${auditDirectory}/${name}`);
      expect(image.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(image.subarray(12, 16).toString("ascii")).toBe("IHDR");
      expect(image.readUInt32BE(16)).toBe(390);
      expect(image.readUInt32BE(20)).toBe(844);
    }
  });

  it("validates the checked-in viewport sample schema and integrity", async () => {
    const metrics = JSON.parse(await readFile(`${auditDirectory}/metrics.json`, "utf8"));
    expect(metrics.viewport).toEqual({ width: 390, height: 844 });
    expect(metrics.states).toHaveLength(8);
    for (const state of metrics.states) {
      expect(state.docScrollWidth).toBeLessThanOrEqual(390);
      expect(state.overlayCount).toBe(0);
    }
    expect(metrics.zoom200.docScrollWidth).toBeLessThanOrEqual(metrics.zoom200.docClientWidth);
    expect(metrics.zoom200.actionRect.left).toBeGreaterThanOrEqual(0);
    expect(metrics.zoom200.actionRect.right).toBeLessThanOrEqual(metrics.zoom200.docClientWidth);
    expect(metrics.zoom200.actionRect.top).toBeGreaterThanOrEqual(0);
    expect(metrics.zoom200.actionRect.bottom).toBeLessThanOrEqual(metrics.zoom200.viewportHeight);
  });
});
