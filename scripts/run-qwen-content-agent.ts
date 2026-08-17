import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createQwenClient, type QwenClient } from "./content-agent/qwenClient";
import { runQwenAgent } from "./content-agent/qwenPipeline";

export const QWEN_REVIEW_QUALITY_VERSION = "qwen-plus-review-v2";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export function createQwenAgentOptions(version: string, client: QwenClient, generatedAt: string) {
  return {
    client,
    version,
    generatedAt,
    qualityVersion: QWEN_REVIEW_QUALITY_VERSION,
    outputDir: resolve(".content-agent"),
    onProgress: ({ category, stage, completed, total }: { category: string; stage: "generate" | "review"; completed: number; total: number }) => process.stdout.write(`进度 ${completed}/${total} · ${category} · ${stage}\n`),
  };
}

async function main() {
  const version = argument("--version");
  if (!version) throw new Error("请通过 --version 指定新内容版本");
  const client = createQwenClient({
    apiKey: process.env.DASHSCOPE_API_KEY ?? "",
    baseUrl: process.env.DASHSCOPE_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: process.env.DASHSCOPE_MODEL ?? "qwen-plus",
    timeoutMs: 120_000,
  });
  const result = await runQwenAgent(createQwenAgentOptions(version, client, new Date().toISOString()));
  process.stdout.write(`候选内容已通过：${result.candidatePath}\n质检报告：${result.reportPath}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
