import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("lazy screen regression test determinism", () => {
  it("drives deferred modules with React act instead of user-event timing", () => {
    const source = readFileSync(`${process.cwd()}/tests/components/lazyScreens.test.tsx`, "utf8");
    expect(source).not.toContain("@testing-library/user-event");
    expect(source).toContain("await act(async () =>");
    expect(source).toContain("fireEvent.click");
  });
});
