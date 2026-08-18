import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generateSystemContent } from "./content-agent/generator";
import { importQwenCheckpoint } from "./content-agent/qwenCheckpoint";

function argument(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function runImportQwenCheckpointCli(args = process.argv.slice(2)) {
  const version = argument(args, "--version");
  const source = argument(args, "--source");
  if (!version) throw new Error("--version is required");
  if (!source) throw new Error("--source is required");
  const destination = resolve(".content-agent", `checkpoint-${version}.json`);
  const result = await importQwenCheckpoint({ source: resolve(source), destination, version, sourceContent: generateSystemContent() });
  process.stdout.write(`Imported ${result.count} phrases to ${result.destination}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await runImportQwenCheckpointCli();
