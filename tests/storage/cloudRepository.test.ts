import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { CloudPhraseRepository } from "../../app/storage/cloudRepository";

describe("CloudPhraseRepository", () => {
  it("invokes the browser fetch function with the global context", async () => {
    const fetcher = vi.fn(function (this: unknown) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(Response.json({ snapshot: null }));
    }) as unknown as typeof fetch;

    const repo = new CloudPhraseRepository(fetcher);
    await expect(repo.initialize()).resolves.toBeUndefined();
  });

  it("starts from cloud data and uploads changes", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === "PUT"
      ? Response.json({ ok: true })
      : Response.json({ snapshot: null }));
    const repo = new CloudPhraseRepository(fetcher);
    await repo.initialize();
    const categories = await repo.listCategories();
    await repo.savePhrase({ id: "mine", english: "Hello", chinese: "你好", categoryId: categories[0].id, reviewStep: 0, masteryLevel: 0, nextReviewAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), origin: "personal", kind: "standalone" });
    expect(fetcher).toHaveBeenCalledWith("/api/repository", expect.objectContaining({ method: "PUT" }));
  });

  it("raises an authentication error on 401", async () => {
    const repo = new CloudPhraseRepository(async () => Response.json({}, { status: 401 }));
    await expect(repo.initialize()).rejects.toMatchObject({ name: "AuthenticationError" });
  });
});
