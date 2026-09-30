import { AuthStore } from "../../app/server/authStore";
import { BUNDLED_SYSTEM_CONTENT_VERSION } from "../../app/domain/bundledSystemContent";

export default async function globalSetup() {
  const path = process.env.PHRASE_E2E_DB_PATH;
  if (!path) throw new Error("PHRASE_E2E_DB_PATH is required");
  const store = new AuthStore(path);
  await store.createUser("e2e", "browser-test-password");
  const scenarioUser = await store.createUser("scenario-e2e", "browser-test-password");
  // Keep this flow's fixture focused on scenarios, independent of first-install bulk content import.
  await store.writeDocument(scenarioUser.id, {
    format: "personal-phrase-bank", version: 5, exportedAt: new Date().toISOString(),
    categories: [], phrases: [], reviewLogs: [], trainingEvents: [], trainingSessions: [],
    learningSessions: [], phraseLearningStates: [], activeSystemContentVersion: BUNDLED_SYSTEM_CONTENT_VERSION,
    appPreferences: { dailyMasteryGoal: 10, dailyNewPhraseGoal: 10 }, speechPreferences: { accent: "en-US", autoSpeak: false },
  });
  store.close();
}
