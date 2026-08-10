import { describe, expect, it, vi } from "vitest";
import { installBundledSystemContent } from "../../app/services/systemContentInstaller";
import { generateSystemContent } from "../../scripts/content-agent/generator";
import { LocalPhraseRepository } from "../../app/storage/indexedDbRepository";

describe("bundled system content installer", () => {
  it("validates and installs a newer bundled package", async () => {
    const repository = { getActiveSystemContentVersion: vi.fn(async () => undefined), installSystemContentPackage: vi.fn(async () => undefined) };
    const fetcher = vi.fn(async () => new Response(JSON.stringify(generateSystemContent()), { status: 200 }));
    await expect(installBundledSystemContent(repository, fetcher)).resolves.toBe("installed");
    expect(fetcher).toHaveBeenCalledWith("/content/system-content-2026.08.1.json", { cache: "no-cache" });
    expect(repository.installSystemContentPackage).toHaveBeenCalledOnce();
  });

  it("does not download a package that is already active", async () => {
    const repository = { getActiveSystemContentVersion: vi.fn(async () => "2026.08.1"), installSystemContentPackage: vi.fn() };
    const fetcher = vi.fn();
    await expect(installBundledSystemContent(repository, fetcher)).resolves.toBe("current");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects failed downloads and invalid payloads before repository writes", async () => {
    const repository = { getActiveSystemContentVersion: vi.fn(async () => undefined), installSystemContentPackage: vi.fn() };
    await expect(installBundledSystemContent(repository, async () => new Response("no", { status: 503 }))).rejects.toThrow("系统句库暂时无法下载");
    await expect(installBundledSystemContent(repository, async () => new Response("{}", { status: 200 }))).rejects.toThrow("系统内容包无效");
    expect(repository.installSystemContentPackage).not.toHaveBeenCalled();
  });

  it("installs all 2000 bundled phrases into an initialized local repository", async () => {
    globalThis.indexedDB = new IDBFactory();
    const repository = new LocalPhraseRepository(`content-install-${crypto.randomUUID()}`);
    await repository.initialize();
    await installBundledSystemContent(repository, async () => new Response(JSON.stringify(generateSystemContent()), { status: 200 }));
    expect((await repository.listPhrases()).filter(({ origin }) => origin === "system")).toHaveLength(2000);
    expect(await repository.getActiveSystemContentVersion()).toBe("2026.08.1");
  });
});
