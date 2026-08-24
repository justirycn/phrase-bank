// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthStore } from "../../app/server/authStore";
import { setAuthStoreForTests } from "../../app/server/httpAuth";
import { POST } from "../../app/api/diagnostics/route";
import { GET } from "../../app/api/health/route";

describe("diagnostics and health routes", () => {
  let store: AuthStore;
  let userId = "";
  let cookie = "";

  beforeEach(async () => {
    store = new AuthStore(":memory:");
    const user = await store.createUser("alice", "1");
    userId = user.id;
    const login = await store.login("alice", "1", "ip");
    cookie = `phrase_session=${login!.token}`;
    setAuthStoreForTests(store);
  });

  it("stores only bounded diagnostic fields for the signed-in user", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await POST(new Request("https://x/api/diagnostics", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ code: "cloud_sync_conflict", screen: "app", online: true, attempt: 1 }),
    }));
    expect(response.status).toBe(204);
    expect(store.listDiagnostics(userId)).toEqual([expect.objectContaining({
      code: "cloud_sync_conflict", screen: "app", online: 1, attempt: 1,
    })]);
    expect(warning).toHaveBeenCalledWith(expect.not.stringContaining("alice"));
  });

  it("rejects arbitrary messages and phrase content", async () => {
    const response = await POST(new Request("https://x/api/diagnostics", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ code: "anything", screen: "app", message: "private phrase" }),
    }));
    expect(response.status).toBe(400);
    expect(store.listDiagnostics(userId)).toEqual([]);
  });

  it("checks the SQLite connection through the public health endpoint", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
