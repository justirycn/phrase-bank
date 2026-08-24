import { AuthStore } from "../../app/server/authStore";

export default async function globalSetup() {
  const path = process.env.PHRASE_E2E_DB_PATH;
  if (!path) throw new Error("PHRASE_E2E_DB_PATH is required");
  const store = new AuthStore(path);
  await store.createUser("e2e", "browser-test-password");
  store.close();
}
