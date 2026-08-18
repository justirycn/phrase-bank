import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertContentVersion } from "./content-agent/qwenCheckpoint";
import { startLocalReviewServer } from "./content-agent/localReviewServer";

export interface LocalContentReviewArguments { version: string; port: number }

export function parseLocalContentReviewArguments(args: string[]): LocalContentReviewArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag !== "--version" && flag !== "--port") throw new Error(`Unknown argument: ${flag}`);
    if (values.has(flag)) throw new Error(`Duplicate argument: ${flag}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    values.set(flag, value);
    index += 1;
  }
  const version = values.get("--version");
  if (!version) throw new Error("--version is required");
  const rawPort = values.get("--port") ?? "43127";
  if (!/^\d+$/u.test(rawPort)) throw new Error("--port must be an integer from 1 to 65535");
  const port = Number(rawPort);
  if (port < 1 || port > 65_535) throw new Error("--port must be an integer from 1 to 65535");
  return { version: assertContentVersion(version), port };
}

export async function runLocalContentReview(args = process.argv.slice(2)): Promise<void> {
  const { version, port } = parseLocalContentReviewArguments(args);
  const server = await startLocalReviewServer({
    candidatePath: resolve(`.content-agent/candidate-${version}.json`),
    reportPath: resolve(`.content-agent/report-${version}.json`),
    reviewPath: resolve(`.content-agent/review-${version}.json`),
    host: "127.0.0.1",
    port,
    sampleSeed: `${version}:manual-review-v1`,
  });
  process.stdout.write(`${server.url}\nPress Ctrl+C to stop.\n`);
  let closing: Promise<void> | undefined;
  const close = () => { closing ??= server.close(); return closing; };
  process.once("SIGINT", () => { void close().then(() => { process.exitCode = 0; }); });
  process.once("SIGTERM", () => { void close().then(() => { process.exitCode = 0; }); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await runLocalContentReview();
