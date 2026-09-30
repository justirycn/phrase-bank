import { cachedScenarioCall, readBoundedBody, scenarioAIConfiguration, scenarioAIError, scenarioJSON, ScenarioRequestError, scenarioUser, transcribeScenario, validateScenarioWav } from "../../../server/scenarioAI";

export async function POST(request: Request) {
  try {
    const user = await scenarioUser(request);
    const config = await scenarioAIConfiguration();
    if (!config) throw new ScenarioRequestError("录音转写尚未配置，可以手动填写回答或直接自评", 503);
    const bytes = await readBoundedBody(request, 2_912_044); validateScenarioWav(bytes);
    return scenarioJSON(await cachedScenarioCall(user.id, "transcribe", bytes, config, () => transcribeScenario(bytes, config)));
  } catch (error) { return scenarioAIError(error); }
}
