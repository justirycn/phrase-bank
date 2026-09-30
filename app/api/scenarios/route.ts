import { isScenarioProgress } from "../../domain/scenarios";
import { authStore, currentUser } from "../../server/httpAuth";
import { DocumentRevisionConflict } from "../../server/authStore";
import { readBoundedBody, scenarioAIError } from "../../server/scenarioAI";

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  return Response.json((await authStore()).readScenarioProgress(user.id), { headers: { "cache-control": "no-store" } });
}
export async function PUT(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "无效来源" }, { status: 403 });
  let raw: string;
  try { raw = new TextDecoder().decode(await readBoundedBody(request, 8_000_000)); } catch (error) { return scenarioAIError(error); }
  let body: { progress?: unknown; revision?: unknown; operationId?: unknown };
  try { body = JSON.parse(raw); } catch { return Response.json({ error: "记录格式错误" }, { status: 400 }); }
  if (!body || !isScenarioProgress(body.progress) || !Number.isSafeInteger(body.revision) || (body.revision as number) < 0 || typeof body.operationId !== "string" || !/^[\w-]{1,80}$/.test(body.operationId)) return Response.json({ error: "记录格式错误" }, { status: 400 });
  try {
    return Response.json({ revision: (await authStore()).writeScenarioProgress(user.id, body.progress, body.revision as number, body.operationId) });
  } catch (error) {
    if (error instanceof DocumentRevisionConflict) return Response.json({ error: "其他设备已更新，请读取云端进度后继续" }, { status: 409 });
    return Response.json({ error: "记录无法保存，请保留本机草稿并重试" }, { status: 400 });
  }
}
