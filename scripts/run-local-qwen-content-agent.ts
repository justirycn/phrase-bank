import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertContentVersion } from "./content-agent/qwenCheckpoint";
import { createQwenClient, type QwenClient, type QwenClientOptions } from "./content-agent/qwenClient";
import { loadLocalQwenEnv, type LoadLocalQwenEnvOptions, type LocalQwenConfig } from "./content-agent/localQwenEnv";
import { runQwenAgent } from "./content-agent/qwenPipeline";
import { createQwenAgentOptions } from "./run-qwen-content-agent";

export interface LocalQwenArguments {
  version: string;
  envPath?: string;
}

export function parseLocalQwenArguments(args: string[]): LocalQwenArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag !== "--version" && flag !== "--env-file") throw new Error(`Unknown argument: ${flag}`);
    if (values.has(flag)) throw new Error(`Duplicate argument: ${flag}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    values.set(flag, value);
    index += 1;
  }
  const version = values.get("--version");
  if (!version) throw new Error("--version is required");
  const envPath = values.get("--env-file");
  return envPath ? { version: assertContentVersion(version), envPath } : { version: assertContentVersion(version) };
}

export function createLocalAgentOptions(version: string, client: QwenClient, generatedAt: string) {
  return createQwenAgentOptions(version, client, generatedAt);
}

interface LocalRunnerDependencies {
  repositoryRoot?: string;
  loadConfig?: (options: LoadLocalQwenEnvOptions) => Promise<LocalQwenConfig>;
  createClient?: (options: QwenClientOptions) => QwenClient;
  runAgent?: typeof runQwenAgent;
  now?: () => Date;
  writeOutput?: (value: string) => void;
}

export async function runLocalQwenContentAgent(args = process.argv.slice(2), dependencies: LocalRunnerDependencies = {}) {
  const parsed = parseLocalQwenArguments(args);
  const config = await (dependencies.loadConfig ?? loadLocalQwenEnv)({
    path: parsed.envPath,
    repositoryRoot: dependencies.repositoryRoot ?? process.cwd(),
  });
  const writeOutput = dependencies.writeOutput ?? ((value: string) => process.stdout.write(value));
  writeOutput("Qwen 配置已读取；请确认配置文件仅当前 Windows 用户可读。\n");

  const client = (dependencies.createClient ?? createQwenClient)({ ...config, timeoutMs: 120_000 });
  const generatedAt = (dependencies.now ?? (() => new Date()))().toISOString();
  const result = await (dependencies.runAgent ?? runQwenAgent)(createLocalAgentOptions(parsed.version, client, generatedAt));
  writeOutput(`候选内容已通过：${result.candidatePath}\n质检报告：${result.reportPath}\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await runLocalQwenContentAgent();
