import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStore } from "../../app/server/authStore";
import { setAuthStoreForTests } from "../../app/server/httpAuth";
import { GET, PUT } from "../../app/api/scenarios/route";
import { newScenarioSession, updateScenario } from "../../app/domain/scenarios";

describe("scenario cloud isolation and concurrency", () => {
  let store: AuthStore; let cookie: string; let userId: string;
  beforeEach(async () => { store = new AuthStore(":memory:"); const user = await store.createUser("alice", "test"); userId = user.id; const login = await store.login("alice", "test", "test"); cookie = `phrase_session=${login!.token}`; setAuthStoreForTests(store); });
  afterEach(() => store.close());
  const save = (body: unknown) => PUT(new Request("https://example.test/api/scenarios", { method: "PUT", headers: { cookie }, body: JSON.stringify(body) }));
  it("authenticates and preserves original phrase learning data", async () => {
    expect((await GET(new Request("https://example.test/api/scenarios"))).status).toBe(401);
    const original = { phrases: [{ id: "keep-me" }] }; await store.writeDocument(userId, original);
    expect((await save({ progress: { sessions: [newScenarioSession("send-samples")] }, revision: 0, operationId: "one" })).status).toBe(200);
    expect(await store.readDocument(userId)).toEqual(original);
  });
  it("retries idempotently, rejects another device's stale overwrite and tampered hint history", async () => {
    const session = updateScenario(newScenarioSession("send-samples"), { type: "hint" });
    const body = { progress: { sessions: [session] }, revision: 0, operationId: "one" };
    expect((await save(body)).status).toBe(200);
    expect(await (await save(body)).json()).toEqual({ revision: 1 });
    expect((await save({ ...body, operationId: "stale" })).status).toBe(409);
    const altered = structuredClone(session); altered.attempts[0].usedHint = false;
    expect((await save({ progress: { sessions: [altered] }, revision: 1, operationId: "tampered" })).status).toBe(400);
  });
});
