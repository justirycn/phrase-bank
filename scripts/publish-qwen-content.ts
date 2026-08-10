import { resolve } from "node:path";
import { publishCandidate } from "./content-agent/publisher";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const version = argument("--version");
if (!version) throw new Error("请通过 --version 指定候选版本");
const result = await publishCandidate({
  version,
  candidatePath: resolve(`.content-agent/candidate-${version}.json`),
  reportPath: resolve(`.content-agent/report-${version}.json`),
  publicDir: resolve("public/content"),
  versionModulePath: resolve("app/domain/bundledSystemContent.ts"),
});
process.stdout.write(`已发布候选内容：${result.destination}\n`);
