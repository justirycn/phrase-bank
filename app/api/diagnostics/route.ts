import { randomUUID } from "node:crypto";
import { authStore, currentUser } from "../../server/httpAuth";

const codes = new Set([
  "cloud_load_failed",
  "cloud_sync_conflict",
  "cloud_sync_failed",
  "training_completion_sync_failed",
  "training_empty_group",
  "training_handoff_timeout",
  "render_error",
  "unhandled_error",
]);
const screens = new Set(["app", "home", "practice", "learning", "library", "settings", "login"]);

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > 4096) return Response.json({ error: "请求过大" }, { status: 413 });
  let body: { code?: unknown; screen?: unknown; online?: unknown; attempt?: unknown };
  try { body = await request.json() as typeof body; }
  catch { return Response.json({ error: "请求格式错误" }, { status: 400 }); }
  if (typeof body.code !== "string" || !codes.has(body.code)
    || typeof body.screen !== "string" || !screens.has(body.screen)
    || (body.online !== undefined && typeof body.online !== "boolean")
    || (body.attempt !== undefined && (!Number.isInteger(body.attempt) || Number(body.attempt) < 0 || Number(body.attempt) > 10))) {
    return Response.json({ error: "诊断数据无效" }, { status: 400 });
  }
  const event = {
    code: body.code,
    screen: body.screen,
    ...(body.online === undefined ? {} : { online: body.online }),
    ...(body.attempt === undefined ? {} : { attempt: Number(body.attempt) }),
    appVersion: process.env.APP_GIT_SHA ?? "development",
  };
  (await authStore()).recordDiagnostic(user.id, event);
  console.warn(JSON.stringify({ type: "phrase_bank_client_diagnostic", eventId: randomUUID(), ...event }));
  return new Response(null, { status: 204 });
}
