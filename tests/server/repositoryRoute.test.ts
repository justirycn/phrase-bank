import { beforeEach, describe, expect, it } from "vitest";
import { AuthStore } from "../../app/server/authStore";
import { setAuthStoreForTests } from "../../app/server/httpAuth";
import { GET, PUT } from "../../app/api/repository/route";

describe("repository route", () => {
  let cookie = "";
  beforeEach(async () => { const store = new AuthStore(":memory:"); await store.createUser("alice", "1"); const login = await store.login("alice", "1", "ip"); setAuthStoreForTests(store); cookie = `phrase_session=${login!.token}`; });
  it("requires login and stores only the current user's snapshot", async () => {
    expect((await GET(new Request("https://x/api/repository"))).status).toBe(401);
    const snapshot = { format: "personal-phrase-bank", version: 4, phrases: [] };
    expect((await PUT(new Request("https://x/api/repository", { method: "PUT", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ snapshot }) }))).status).toBe(200);
    expect(await (await GET(new Request("https://x/api/repository", { headers: { cookie } }))).json()).toEqual({ snapshot });
  });
});
// @vitest-environment node
