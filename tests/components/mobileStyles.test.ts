import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("mobile phrase typography", () => {
  it("keeps long English phrases wrappable without clipping", async () => {
    const css = await readFile("app/globals.css", "utf8");
    const rule = css.match(/\.phrase-english\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(rule).toMatch(/white-space:\s*normal\s*;/);
    expect(rule).toMatch(/overflow-wrap:\s*anywhere\s*;/);
  });
});
