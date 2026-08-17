import { currentUser, authStore } from "../../server/httpAuth";

export async function GET(request: Request) {
  const user = await currentUser(request); if (!user) return Response.json({ error: "未登录" }, { status: 401 });
  return Response.json({ snapshot: await (await authStore()).readDocument(user.id) });
}
export async function PUT(request: Request) {
  const user = await currentUser(request); if (!user) return Response.json({ error: "未登录" }, { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > 5_000_000) return Response.json({ error: "请求过大" }, { status: 413 });
  let body: { snapshot?: unknown };
  try {
    if (request.headers.get("content-encoding") === "gzip") {
      if (!request.body) return Response.json({ error: "数据格式错误" }, { status: 400 });
      const decoded = await new Response(request.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
      if (decoded.byteLength > 5_000_000) return Response.json({ error: "请求过大" }, { status: 413 });
      body = JSON.parse(new TextDecoder().decode(decoded)) as { snapshot?: unknown };
    } else {
      body = await request.json() as { snapshot?: unknown };
    }
  } catch {
    return Response.json({ error: "数据格式错误" }, { status: 400 });
  }
  if (!body.snapshot || typeof body.snapshot !== "object") return Response.json({ error: "数据格式错误" }, { status: 400 });
  await (await authStore()).writeDocument(user.id, body.snapshot); return Response.json({ ok: true });
}
