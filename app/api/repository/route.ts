import { DocumentRevisionConflict } from "../../server/authStore";
import { currentUser, authStore } from "../../server/httpAuth";

export async function GET(request: Request) {
  const user = await currentUser(request); if (!user) return Response.json({ error: "未登录" }, { status: 401 });
  const record = await (await authStore()).readDocumentRecord(user.id);
  return Response.json({ snapshot: record.document, revision: record.revision });
}
export async function PUT(request: Request) {
  const user = await currentUser(request); if (!user) return Response.json({ error: "未登录" }, { status: 401 });
  const revisionHeader = request.headers.get("x-document-revision");
  if (revisionHeader === null || !/^\d+$/.test(revisionHeader)) return Response.json({ error: "缺少云端数据版本" }, { status: 428 });
  const expectedRevision = Number(revisionHeader);
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
  try {
    const revision = await (await authStore()).writeDocument(user.id, body.snapshot, expectedRevision);
    return Response.json({ ok: true, revision });
  } catch (error) {
    if (error instanceof DocumentRevisionConflict) return Response.json({ error: error.message, revision: error.currentRevision }, { status: 409 });
    throw error;
  }
}

export async function PATCH(request: Request) {
  const user = await currentUser(request); if (!user) return Response.json({ error: "未登录" }, { status: 401 });
  let body: { trainingSessionCompletion?: { id?: unknown; completedAt?: unknown } };
  try { body = await request.json() as typeof body; }
  catch { return Response.json({ error: "数据格式错误" }, { status: 400 }); }
  const completion = body.trainingSessionCompletion;
  if (
    typeof completion?.id !== "string"
    || typeof completion.completedAt !== "string"
    || Number.isNaN(new Date(completion.completedAt).getTime())
  ) return Response.json({ error: "数据格式错误" }, { status: 400 });
  const completedAt = new Date(completion.completedAt).getTime();
  try {
    const result = await (await authStore()).mutateDocument(user.id, (snapshot) => {
      if (!snapshot || typeof snapshot !== "object") throw new Error("找不到云端数据");
      const document = snapshot as { trainingSessions?: Array<Record<string, unknown>> };
      if (!Array.isArray(document.trainingSessions)) throw new Error("找不到训练记录");
      if (!document.trainingSessions.some((session) => session.id === completion.id)) throw new Error("找不到训练记录");
      document.trainingSessions = document.trainingSessions.flatMap((session) => {
        if (session.id === completion.id) return [{ ...session, completedAt: completion.completedAt, updatedAt: completion.completedAt }];
        const startedAt = typeof session.startedAt === "string" ? new Date(session.startedAt).getTime() : Number.NaN;
        return !session.completedAt && startedAt < completedAt ? [] : [session];
      });
      return document;
    });
    return Response.json({ ok: true, revision: result.revision });
  } catch (error) {
    if (error instanceof Error && /找不到/.test(error.message)) return Response.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
