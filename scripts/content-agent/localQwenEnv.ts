import { lstat, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

const ALLOWED_KEYS = new Set(["DASHSCOPE_API_KEY", "DASHSCOPE_BASE_URL", "DASHSCOPE_MODEL"]);

export interface LocalQwenConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface LoadLocalQwenEnvOptions {
  path?: string;
  repositoryRoot: string;
}

export function getDefaultLocalQwenEnvPath(): string {
  return join(homedir(), ".phrase-bank", "qwen-content.env");
}

function isWithin(parent: string, candidate: string): boolean {
  const relation = relative(parent, candidate);
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

export async function loadLocalQwenEnv(options: LoadLocalQwenEnvOptions): Promise<LocalQwenConfig> {
  const requestedPath = resolve(options.path ?? getDefaultLocalQwenEnvPath());
  const repositoryRoot = await realpath(resolve(options.repositoryRoot));

  if (isWithin(repositoryRoot, requestedPath)) throw new Error(`Qwen configuration path must be outside the repository: ${requestedPath}`);

  let stats;
  try {
    stats = await lstat(requestedPath);
  } catch {
    throw new Error(`Qwen configuration file is unavailable: ${requestedPath}`);
  }
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) {
    throw new Error(`Qwen configuration must be an ordinary file with a single link (non-symlink): ${requestedPath}`);
  }

  const canonicalPath = await realpath(requestedPath);
  if (isWithin(repositoryRoot, canonicalPath)) throw new Error(`Qwen configuration path must resolve outside the repository: ${requestedPath}`);

  const bytes = await readFile(canonicalPath);
  let contents: string;
  try {
    contents = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Qwen 配置文件不是有效 UTF-8");
  }
  const values = new Map<string, string>();
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals <= 0) throw new Error(`Malformed Qwen configuration line in ${requestedPath}`);
    const key = line.slice(0, equals);
    const value = line.slice(equals + 1);
    if (!ALLOWED_KEYS.has(key)) throw new Error(`Unknown Qwen configuration key in ${requestedPath}`);
    if (values.has(key)) throw new Error(`Duplicate Qwen configuration key ${key} in ${requestedPath}`);
    if (!value.trim()) throw new Error(`Qwen configuration key ${key} must not be empty in ${requestedPath}`);
    values.set(key, value);
  }

  for (const key of ALLOWED_KEYS) {
    if (!values.has(key)) throw new Error(`Missing Qwen configuration key ${key} in ${requestedPath}`);
  }

  const baseUrl = values.get("DASHSCOPE_BASE_URL")!;
  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(baseUrl);
  } catch {
    throw new Error(`DASHSCOPE_BASE_URL must be an HTTPS URL in ${requestedPath}`);
  }
  if (
    parsedBaseUrl.protocol !== "https:"
    || parsedBaseUrl.username !== ""
    || parsedBaseUrl.password !== ""
    || parsedBaseUrl.search !== ""
    || parsedBaseUrl.hash !== ""
    || baseUrl.includes("?")
    || baseUrl.includes("#")
  ) {
    throw new Error(`DASHSCOPE_BASE_URL must be an HTTPS URL without credentials, query, or fragment in ${requestedPath}`);
  }
  const normalizedBaseUrl = parsedBaseUrl.href.replace(/\/+$/, "");

  return {
    apiKey: values.get("DASHSCOPE_API_KEY")!,
    baseUrl: normalizedBaseUrl,
    model: values.get("DASHSCOPE_MODEL")!,
  };
}
