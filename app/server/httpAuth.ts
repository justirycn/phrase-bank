import type { AuthStore } from "./authStore";

let testStore: AuthStore | undefined;
export function setAuthStoreForTests(store: AuthStore) { testStore = store; }
export async function authStore() {
  if (testStore) return testStore;
  const { AuthStore } = await import("./authStore");
  return new AuthStore(process.env.PHRASE_DB_PATH ?? "./data/phrase-bank.sqlite");
}
export function cookieToken(request: Request) {
  return request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("phrase_session="))?.slice("phrase_session=".length);
}
export const sessionCookie = (token: string, maxAge = 2592000) => `phrase_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
export async function currentUser(request: Request) {
  const token = cookieToken(request); return token ? (await authStore()).resolveSession(token) : undefined;
}
