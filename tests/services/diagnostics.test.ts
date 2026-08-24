import { describe, expect, it, vi } from "vitest";
import { createDiagnosticReporter } from "../../app/services/diagnostics";

describe("client diagnostics", () => {
  it("sends an allowlisted code and bounded context without error text", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    const report = createDiagnosticReporter(fetcher);
    report("training_empty_group", { screen: "practice", online: true });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    const init = fetcher.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ code: "training_empty_group", screen: "practice", online: true });
    expect(String(init.body)).not.toMatch(/message|phrase|error/i);
  });

  it("throttles repeated reports for the same code and screen", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    const report = createDiagnosticReporter(fetcher);
    report("cloud_sync_failed", { screen: "app" });
    report("cloud_sync_failed", { screen: "app", attempt: 2 });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  });
});
