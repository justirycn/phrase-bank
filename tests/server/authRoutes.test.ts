import { beforeEach, describe, expect, it } from "vitest";
import { AuthStore } from "../../app/server/authStore";
import { setAuthStoreForTests } from "../../app/server/httpAuth";
import { POST as login } from "../../app/api/auth/login/route";
import { GET as session } from "../../app/api/auth/session/route";
import { POST as logout } from "../../app/api/auth/logout/route";

const request = (url: string, init: RequestInit = {}) => new Request(`https://phrase.archdemy.com${url}`, init);

describe("auth routes", () => {
  beforeEach(async () => { const store = new AuthStore(":memory:"); await store.createUser("alice", "1234"); setAuthStoreForTests(store); });

  it("logs in with a secure 30-day cookie and restores the session", async () => {
    const response = await login(request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "alice", password: "1234" }) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: { username: "alice" } });
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("phrase_session="); expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("Secure"); expect(cookie).toContain("SameSite=Lax"); expect(cookie).toContain("Max-Age=2592000");
    const restored = await session(request("/api/auth/session", { headers: { cookie: cookie.split(";")[0] } }));
    expect(await restored.json()).toEqual({ user: { username: "alice" } });
  });

  it("uses one error for invalid credentials and clears logout cookie", async () => {
    const bad = await login(request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "missing", password: "bad" }) }));
    expect(bad.status).toBe(401); expect(await bad.json()).toEqual({ error: "账号或密码错误" });
    const out = await logout(request("/api/auth/logout", { method: "POST", headers: { cookie: "phrase_session=invalid" } }));
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("rejects invalid or oversized JSON", async () => {
    expect((await login(request("/api/auth/login", { method: "POST", body: "{" }))).status).toBe(400);
    expect((await login(request("/api/auth/login", { method: "POST", headers: { "content-length": "70000" }, body: "{}" }))).status).toBe(413);
  });
});
// @vitest-environment node
