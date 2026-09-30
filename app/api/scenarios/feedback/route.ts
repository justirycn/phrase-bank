import { cachedScenarioCall, coachScenario, parseFeedbackInput, readBoundedBody, scenarioAIConfiguration, scenarioAIError, scenarioJSON, ScenarioRequestError, scenarioUser } from "../../../server/scenarioAI";

export async function POST(request: Request) {
  try {
    const user = await scenarioUser(request);
    const config = await scenarioAIConfiguration();
    if (!config) throw new ScenarioRequestError("AI 反馈尚未配置，可以回听并直接自评", 503);
    const bytes = await readBoundedBody(request, 16_000);
    let raw: unknown; try { raw = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ScenarioRequestError("无效请求", 400); }
    const input = parseFeedbackInput(raw);
    return scenarioJSON({ feedback: await cachedScenarioCall(user.id, "feedback", JSON.stringify(input), config, () => coachScenario(input, config)) });
  } catch (error) { return scenarioAIError(error); }
}
