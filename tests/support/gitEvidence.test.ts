import { describe, expect, it, vi } from "vitest";
import { readCurrentAppTree } from "../../scripts/gitEvidence";

describe("optional live Git evidence verification", () => {
  it("returns unavailable when the production image has no git executable", () => {
    const missingGit = vi.fn(() => { const error = Object.assign(new Error("spawnSync git ENOENT"), { code: "ENOENT" }); throw error; });
    expect(readCurrentAppTree(process.cwd(), missingGit)).toBeUndefined();
  });

  it("returns unavailable without invoking git when repository metadata is absent", () => {
    const execute = vi.fn(() => {
      throw new Error("git must not run without repository metadata");
    });
    const rootWithoutGit = `${process.cwd()}/.missing-git-metadata-${process.pid}`;

    expect(readCurrentAppTree(rootWithoutGit, execute)).toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns the live app tree when git is available", () => {
    expect(readCurrentAppTree(process.cwd(), vi.fn(() => "abc123\n"))).toBe("abc123");
  });

  it("does not hide other git failures", () => {
    expect(() => readCurrentAppTree(process.cwd(), vi.fn(() => { throw new Error("bad revision"); }))).toThrow("bad revision");
  });
});
