import { resolve } from "node:path";
import { createQwenClient } from "./content-agent/qwenClient";
import { runQwenAgent } from "./content-agent/qwenPipeline";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const version = argument("--version");
if (!version) throw new Error("请通过 --version 指定新内容版本");
const client = createQwenClient({
  apiKey: process.env.DASHSCOPE_API_KEY ?? "",
  baseUrl: process.env.DASHSCOPE_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1",
  model: process.env.DASHSCOPE_MODEL ?? "qwen-plus",
  timeoutMs: 120_000,
});
const result = await runQwenAgent({
  client,
  version,
  generatedAt: new Date().toISOString(),
  qualityVersion: "qwen-plus-review-v1",
  outputDir: resolve(".content-agent"),
  onProgress: ({ category, stage, completed, total }) => process.stdout.write(`进度 ${completed}/${total} · ${category} · ${stage}\n`),
});
process.stdout.write(`候选内容已通过：${result.candidatePath}\n质检报告：${result.reportPath}\n`);
