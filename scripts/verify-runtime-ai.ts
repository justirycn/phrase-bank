// Read-only deployment check. Never prints a key, model-list payload or user data;
// /models verifies credentials/connectivity without generating paid content.
import { qwenConfiguration, speechConfiguration } from "../app/server/naturalSpeech";
import { scenarioAIConfiguration } from "../app/server/scenarioAI";

try {
  const config = await qwenConfiguration();
  if (!config || !await speechConfiguration() || !await scenarioAIConfiguration()) throw new Error("missing-runtime-ai-configuration");
  const response = await fetch(`https://${config.host}/compatible-mode/v1/models`, {
    headers: { authorization: `Bearer ${config.apiKey}` }, signal: AbortSignal.timeout(20_000), redirect: "error",
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error(`runtime-ai-auth-http-${response.status}`);
  console.log(JSON.stringify({ runtimeAI: "configured-and-authenticated", productionSha: process.env.APP_GIT_SHA, paidGeneration: false }));
} catch (error) {
  // Intentionally do not print network errors/URLs or provider responses.
  const known = error instanceof Error && /^(missing-runtime-ai-configuration|runtime-ai-auth-http-\d+)$/.test(error.message);
  console.error(known && error instanceof Error ? error.message : "runtime-ai-connectivity-check-failed");
  process.exitCode = 1;
}
