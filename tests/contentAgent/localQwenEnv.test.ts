import { lstat, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDefaultLocalQwenEnvPath, loadLocalQwenEnv } from "../../scripts/content-agent/localQwenEnv";

const SECRET = "sk-fixture=value-never-log";
const validEnv = `DASHSCOPE_API_KEY=${SECRET}\nDASHSCOPE_BASE_URL=https://example.invalid/v1\nDASHSCOPE_MODEL=qwen-test\n`;
const temporaryPaths: string[] = [];

async function fixture(contents: string | Uint8Array = validEnv) {
  const directory = await mkdtemp(join(tmpdir(), "phrase-bank-local-qwen-"));
  temporaryPaths.push(directory);
  const path = join(directory, "qwen-content.env");
  await writeFile(path, contents, "utf8");
  return { directory, path };
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("local Qwen environment loader", () => {
  it("computes the default path from the current home directory", () => {
    expect(getDefaultLocalQwenEnvPath()).toBe(join(homedir(), ".phrase-bank", "qwen-content.env"));
  });

  it("loads an external ordinary file and preserves equals signs in values", async () => {
    const { path } = await fixture();
    await expect(loadLocalQwenEnv({ path, repositoryRoot: process.cwd() })).resolves.toEqual({
      apiKey: SECRET,
      baseUrl: "https://example.invalid/v1",
      model: "qwen-test",
    });
  });

  it("rejects missing files, directories, and paths in the repository", async () => {
    const external = await mkdtemp(join(tmpdir(), "phrase-bank-local-qwen-directory-"));
    temporaryPaths.push(external);
    await expect(loadLocalQwenEnv({ path: join(external, "missing.env"), repositoryRoot: process.cwd() })).rejects.toThrow(/file|path/i);
    await expect(loadLocalQwenEnv({ path: external, repositoryRoot: process.cwd() })).rejects.toThrow(/ordinary file/i);
    await expect(loadLocalQwenEnv({ path: process.cwd(), repositoryRoot: process.cwd() })).rejects.toThrow(/repository/i);
    const inside = resolve(process.cwd(), ".local-qwen-test.env");
    await writeFile(inside, validEnv, "utf8");
    try {
      await expect(loadLocalQwenEnv({ path: inside, repositoryRoot: process.cwd() })).rejects.toThrow(/repository/i);
    } finally {
      const { rm } = await import("node:fs/promises");
      await rm(inside, { force: true });
    }
  });

  it("rejects symlinked files and resolved directory links into the repository when supported", async () => {
    const external = await mkdtemp(join(tmpdir(), "phrase-bank-local-qwen-link-"));
    temporaryPaths.push(external);
    const inside = resolve(process.cwd(), ".local-qwen-link-target.env");
    await writeFile(inside, validEnv, "utf8");
    try {
      const fileLink = join(external, "file.env");
      try {
        await symlink(inside, fileLink, "file");
        expect((await lstat(fileLink)).isSymbolicLink()).toBe(true);
        await expect(loadLocalQwenEnv({ path: fileLink, repositoryRoot: process.cwd() })).rejects.toThrow(/symlink|ordinary file|repository/i);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      }

      const directoryLink = join(external, "repository-link");
      try {
        await symlink(process.cwd(), directoryLink, process.platform === "win32" ? "junction" : "dir");
        await expect(loadLocalQwenEnv({ path: join(directoryLink, ".local-qwen-link-target.env"), repositoryRoot: process.cwd() })).rejects.toThrow(/repository/i);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      }
    } finally {
      const { rm } = await import("node:fs/promises");
      await rm(inside, { force: true });
    }
  });

  it.each([
    ["missing key", "DASHSCOPE_BASE_URL=https://example.invalid\nDASHSCOPE_MODEL=qwen-test\n"],
    ["duplicate key", `${validEnv}DASHSCOPE_MODEL=again\n`],
    ["unknown key", `${validEnv}OTHER=value\n`],
    ["malformed line", `${validEnv}not-an-assignment\n`],
    ["malformed key", `${validEnv}=value\n`],
    ["empty key", validEnv.replace(`DASHSCOPE_API_KEY=${SECRET}`, "DASHSCOPE_API_KEY=")],
    ["blank key", validEnv.replace(`DASHSCOPE_API_KEY=${SECRET}`, "DASHSCOPE_API_KEY=   ")],
    ["empty URL", validEnv.replace("https://example.invalid/v1", "")],
    ["empty model", validEnv.replace("qwen-test", "")],
    ["blank model", validEnv.replace("qwen-test", "   ")],
    ["non-URL base", validEnv.replace("https://example.invalid/v1", "not-a-url")],
    ["non-http base", validEnv.replace("https://example.invalid/v1", "file:///tmp/qwen")],
  ])("rejects %s without exposing file contents", async (_name, contents) => {
    const { path } = await fixture(contents);
    let message = "";
    try {
      await loadLocalQwenEnv({ path, repositoryRoot: process.cwd() });
    } catch (error) {
      message = String(error);
    }
    expect(message).not.toBe("");
    expect(message).not.toContain(SECRET);
  });

  it("accepts blank lines and comments but requires exact untrimmed KEY=value syntax", async () => {
    const accepted = await fixture(`# local only\n\n \t \n   # indented local comment\n${validEnv}`);
    await expect(loadLocalQwenEnv({ path: accepted.path, repositoryRoot: process.cwd() })).resolves.toMatchObject({ apiKey: SECRET });

    for (const invalidLine of [" DASHSCOPE_API_KEY=value", "DASHSCOPE_API_KEY =value", "export DASHSCOPE_API_KEY=value"]) {
      const invalid = await fixture(`${invalidLine}\nDASHSCOPE_BASE_URL=https://example.invalid\nDASHSCOPE_MODEL=qwen-test\n`);
      await expect(loadLocalQwenEnv({ path: invalid.path, repositoryRoot: process.cwd() })).rejects.toThrow();
    }
  });

  it("rejects malformed UTF-8 without exposing bytes, contents, or keys", async () => {
    const invalidBytes = Buffer.concat([
      Buffer.from(`DASHSCOPE_API_KEY=${SECRET}\n`, "utf8"),
      Buffer.from([0xc3, 0x28]),
    ]);
    const { path } = await fixture(invalidBytes);
    const stdout = vi.spyOn(process.stdout, "write");
    const stderr = vi.spyOn(process.stderr, "write");
    try {
      let failure = "";
      try {
        await loadLocalQwenEnv({ path, repositoryRoot: process.cwd() });
      } catch (error) {
        failure = String(error);
      }
      const captured = `${stdout.mock.calls.flat().join("")}${stderr.mock.calls.flat().join("")}`;
      expect(failure).toBe("Error: Qwen 配置文件不是有效 UTF-8");
      expect(failure).not.toContain("DASHSCOPE_API_KEY");
      expect(failure).not.toContain(SECRET);
      expect(captured).toBe("");
      expect(captured).not.toContain(SECRET);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });
});
