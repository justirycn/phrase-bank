import { currentUser } from "../../../server/httpAuth";
export async function GET(request: Request) {
  const user = await currentUser(request);
  return user ? Response.json({ user: { username: user.username } }) : Response.json({ error: "未登录" }, { status: 401 });
}
