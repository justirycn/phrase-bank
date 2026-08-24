import { authStore } from "../../server/httpAuth";

export async function GET() {
  try {
    const result = (await authStore()).health();
    if (result.ok !== 1) throw new Error("database check failed");
    return Response.json({ ok: true, version: process.env.APP_GIT_SHA ?? "development" }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
