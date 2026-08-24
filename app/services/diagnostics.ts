export type DiagnosticCode =
  | "cloud_load_failed"
  | "cloud_sync_conflict"
  | "cloud_sync_failed"
  | "training_completion_sync_failed"
  | "training_empty_group"
  | "training_handoff_timeout"
  | "render_error"
  | "unhandled_error";

export type DiagnosticScreen = "app" | "home" | "practice" | "learning" | "library" | "settings" | "login";
export type DiagnosticContext = { screen: DiagnosticScreen; online?: boolean; attempt?: number };
export type DiagnosticReporter = (code: DiagnosticCode, context: DiagnosticContext) => void;

export function createDiagnosticReporter(fetcher: typeof fetch = fetch): DiagnosticReporter {
  const lastSent = new Map<string, number>();
  return (code, context) => {
    const key = `${code}:${context.screen}`;
    const now = Date.now();
    if (now - (lastSent.get(key) ?? 0) < 30_000) return;
    lastSent.set(key, now);
    void fetcher("/api/diagnostics", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, ...context }),
    }).catch(() => undefined);
  };
}

export const reportClientDiagnostic = createDiagnosticReporter();
