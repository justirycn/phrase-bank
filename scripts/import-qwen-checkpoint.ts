import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generateSystemContent } from "./content-agent/generator";
import { assertContentVersion, importQwenCheckpoint } from "./content-agent/qwenCheckpoint";

export function parseImportQwenCheckpointArguments(args: string[]): { version: string; source: string } {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag !== "--version" && flag !== "--source") throw new Error(`Unknown argument: ${flag}`);
    if (values.has(flag)) throw new Error(`Duplicate argument: ${flag}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    values.set(flag, value);
    index += 1;
  }
  const version = values.get("--version");
  const source = values.get("--source");
  if (!version) throw new Error("--version is required");
  if (!source) throw new Error("--source is required");
  return { version: assertContentVersion(version), source };
}

export async function runImportQwenCheckpointCli(args = process.argv.slice(2)) {
  const { version, source } = parseImportQwenCheckpointArguments(args);
  const destination = resolve(".content-agent", `checkpoint-${version}.json`);
  const result = await importQwenCheckpoint({ source: resolve(source), destination, version, sourceContent: generateSystemContent() });
  process.stdout.write(`Imported ${result.count} phrases to ${result.destination}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await runImportQwenCheckpointCli();
