import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScenarioConflictError, ScenarioProgressStore } from "../../app/services/scenarioProgress";
import { newScenarioSession, updateScenario } from "../../app/domain/scenarios";

describe("scenario drafts", () => {
  beforeEach(() => localStorage.clear());
  it("saves locally before a failed cloud write and isolates accounts", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    const store = new ScenarioProgressStore("alice", true, fetcher);
    const session = newScenarioSession("send-samples");
    await expect(store.save({ sessions: [session] })).rejects.toThrow();
    expect(store.localSaved).toBe(true);
    expect(new ScenarioProgressStore("alice", true, fetcher).readLocal().sessions[0].id).toBe(session.id);
    expect(new ScenarioProgressStore("bob", true, fetcher).readLocal().sessions).toHaveLength(0);
  });
  it("serializes fast changes with the last acknowledged cloud revision", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ revision: 1 })).mockResolvedValueOnce(Response.json({ revision: 2 }));
    const store = new ScenarioProgressStore("alice", true, fetcher);
    const session = newScenarioSession("send-samples");
    await store.save({ sessions: [session] });
    await store.save({ sessions: [updateScenario(session, { type: "hint" })] });
    expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string).revision).toBe(1);
  });
  it("calls native browser fetch with the Window receiver", async () => {
    const fetcher = vi.fn(function(this: unknown) {
      expect(this).toBe(globalThis);
      return Promise.resolve(Response.json({ progress: { sessions: [] }, revision: 0 }));
    });
    await new ScenarioProgressStore("alice", true, fetcher).load();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("reports failed local-only persistence instead of claiming a saved draft", async () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage full"); });
    try { await expect(new ScenarioProgressStore("local", false).save({ sessions: [newScenarioSession("refund")] })).rejects.toThrow("本机存储"); }
    finally { spy.mockRestore(); }
  });
  it("does not overwrite another device; preserves the losing draft before explicit cloud reload", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 409 })).mockResolvedValueOnce(Response.json({ progress: { sessions: [] }, revision: 2 }));
    const store = new ScenarioProgressStore("alice", true, fetcher);
    await expect(store.save({ sessions: [newScenarioSession("refund")] })).rejects.toBeInstanceOf(ScenarioConflictError);
    await store.load(true);
    expect(localStorage.getItem("phrase-scenarios-v1:alice:conflict-copy")).toContain("refund");
  });
});
