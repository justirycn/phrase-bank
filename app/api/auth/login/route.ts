import { authStore, sessionCookie } from "../../../server/httpAuth";

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 65536) return Response.json({ error: "请求过大" }, { status: 413 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "请求格式错误" }, { status: 400 }); }
  const { username, password } = (body ?? {}) as { username?: unknown; password?: unknown };
  if (typeof username !== "string" || typeof password !== "string") return Response.json({ error: "请求格式错误" }, { status: 400 });
  const result = await (await authStore()).login(username, password, request.headers.get("x-forwarded-for") ?? "unknown");
  if (!result) return Response.json({ error: "账号或密码错误" }, { status: 401 });
  return Response.json({ user: { username: result.user.username } }, { headers: { "set-cookie": sessionCookie(result.token) } });
}
