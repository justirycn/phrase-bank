import { describe, expect, it } from "vitest";
import { AuthStore } from "../../app/server/authStore";

function store(now = () => new Date("2026-08-12T00:00:00.000Z")) {
  return new AuthStore(":memory:", now);
}

describe("AuthStore", () => {
  it("creates accounts with hashed passwords and rejects duplicates", async () => {
    const auth = store();
    const user = await auth.createUser("alice", "1234");
    expect(user.username).toBe("alice");
    expect(auth.passwordMaterial("alice")).not.toContain("1234");
    await expect(auth.createUser("alice", "other")).rejects.toThrow("账号已存在");
  });

  it("logs in, resolves a 30-day session, and logs out", async () => {
    let now = new Date("2026-08-12T00:00:00.000Z");
    const auth = store(() => now); await auth.createUser("alice", "1234");
    await expect(auth.login("alice", "wrong", "ip")).resolves.toBeUndefined();
    const login = await auth.login("alice", "1234", "ip");
    expect(login?.token).toMatch(/^[a-f0-9]{64}$/);
    expect(await auth.resolveSession(login!.token)).toMatchObject({ username: "alice" });
    now = new Date("2026-09-10T23:59:59.000Z");
    expect(await auth.resolveSession(login!.token)).toBeDefined();
    now = new Date("2026-09-11T00:00:01.000Z");
    expect(await auth.resolveSession(login!.token)).toBeUndefined();
    const next = await auth.login("alice", "1234", "ip2");
    await auth.logout(next!.token);
    expect(await auth.resolveSession(next!.token)).toBeUndefined();
  });

  it("invalidates sessions when an account is disabled", async () => {
    const auth = store(); await auth.createUser("alice", "1234");
    const login = await auth.login("alice", "1234", "ip");
    await auth.setEnabled("alice", false);
    expect(await auth.resolveSession(login!.token)).toBeUndefined();
    expect(await auth.login("alice", "1234", "ip")).toBeUndefined();
  });

  it("isolates documents by authenticated user id", async () => {
    const auth = store(); const a = await auth.createUser("alice", "1"); const b = await auth.createUser("bob", "2");
    await auth.writeDocument(a.id, { phrases: [{ id: "same", english: "A" }] });
    await auth.writeDocument(b.id, { phrases: [{ id: "same", english: "B" }] });
    expect(await auth.readDocument(a.id)).toMatchObject({ phrases: [{ english: "A" }] });
    expect(await auth.readDocument(b.id)).toMatchObject({ phrases: [{ english: "B" }] });
  });
});
