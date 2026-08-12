import { authStore, cookieToken, sessionCookie } from "../../../server/httpAuth";
export async function POST(request: Request) {
  const token = cookieToken(request); if (token) await (await authStore()).logout(token);
  return Response.json({ ok: true }, { headers: { "set-cookie": sessionCookie("", 0) } });
}
