import { beforeEach, describe, expect, it } from "vitest";
import { AuthStore } from "../../app/server/authStore";
import { setAuthStoreForTests } from "../../app/server/httpAuth";
import { GET, PATCH, PUT } from "../../app/api/repository/route";

describe("repository route", () => {
  let cookie = "";
  beforeEach(async () => { const store = new AuthStore(":memory:"); await store.createUser("alice", "1"); const login = await store.login("alice", "1", "ip"); setAuthStoreForTests(store); cookie = `phrase_session=${login!.token}`; });
  it("requires login and stores only the current user's snapshot", async () => {
    expect((await GET(new Request("https://x/api/repository"))).status).toBe(401);
    const snapshot = { format: "personal-phrase-bank", version: 4, phrases: [] };
    expect((await PUT(new Request("https://x/api/repository", { method: "PUT", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ snapshot }) }))).status).toBe(200);
    expect(await (await GET(new Request("https://x/api/repository", { headers: { cookie } }))).json()).toEqual({ snapshot });
  });

  it("accepts a gzip-compressed cloud snapshot", async () => {
    const snapshot = { format: "personal-phrase-bank", version: 5, phrases: [{ id: "compressed" }] };
    const encoded = new TextEncoder().encode(JSON.stringify({ snapshot }));
    const compressed = await new Response(
      new Blob([encoded]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer();

    const response = await PUT(new Request("https://x/api/repository", {
      method: "PUT",
      headers: { cookie, "content-type": "application/json", "content-encoding": "gzip" },
      body: compressed,
    }));

    expect(response.status).toBe(200);
    expect(await (await GET(new Request("https://x/api/repository", { headers: { cookie } }))).json()).toEqual({ snapshot });
  });

  it("updates one completed training session without replacing the cloud snapshot", async () => {
    const snapshot = {
      format: "personal-phrase-bank", version: 5, phrases: [{ id: "kept" }],
      trainingSessions: [{ id: "session", currentIndex: 3 }],
    };
    await PUT(new Request("https://x/api/repository", {
      method: "PUT", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ snapshot }),
    }));

    const response = await PATCH(new Request("https://x/api/repository", {
      method: "PATCH", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ trainingSessionCompletion: {
        id: "session", completedAt: "2026-08-10T08:01:00.000Z",
      } }),
    }));

    expect(response.status).toBe(200);
    expect(await (await GET(new Request("https://x/api/repository", { headers: { cookie } }))).json()).toEqual({
      snapshot: {
        ...snapshot,
        trainingSessions: [{
          id: "session", currentIndex: 3,
          completedAt: "2026-08-10T08:01:00.000Z", updatedAt: "2026-08-10T08:01:00.000Z",
        }],
      },
    });
  });
});
// @vitest-environment node
