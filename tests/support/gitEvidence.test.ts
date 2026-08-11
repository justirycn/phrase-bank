import { describe, expect, it, vi } from "vitest";
import { readCurrentAppTree } from "../../scripts/gitEvidence";

describe("optional live Git evidence verification", () => {
  it("returns unavailable when the production image has no git executable", () => {
    const missingGit = vi.fn(() => { const error = Object.assign(new Error("spawnSync git ENOENT"), { code: "ENOENT" }); throw error; });
    expect(readCurrentAppTree(process.cwd(), missingGit)).toBeUndefined();
  });

  it("returns the live app tree when git is available", () => {
    expect(readCurrentAppTree("/repo", vi.fn(() => "abc123\n"))).toBe("abc123");
  });

  it("does not hide other git failures", () => {
    expect(() => readCurrentAppTree(process.cwd(), vi.fn(() => { throw new Error("bad revision"); }))).toThrow("bad revision");
  });
});
