import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { SystemContentPackage, SystemContentPhrase } from "../../app/domain/types";

export interface QwenCheckpoint {
  version: string;
  sourceSha256: string;
  phrases: SystemContentPhrase[];
}

interface LoadOptions {
  path: string;
  version: string;
  sourceContent: SystemContentPackage;
}

interface ImportOptions {
  source: string;
  destination: string;
  version: string;
  sourceContent: SystemContentPackage;
}

const MUTABLE_PHRASE_FIELDS = new Set(["english", "chinese", "contentVersion", "qualityVersion"]);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function immutableMetadata(phrase: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(phrase).filter(([key]) => !MUTABLE_PHRASE_FIELDS.has(key)));
}

export function sourceSha256(content: SystemContentPackage): string {
  const metadata = content.phrases.map((phrase) => immutableMetadata(phrase as unknown as Record<string, unknown>));
  return createHash("sha256").update(canonical(metadata)).digest("hex");
}

function validatePhrase(value: unknown, index: number): asserts value is SystemContentPhrase {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Checkpoint phrase ${index + 1} is malformed`);
  const phrase = value as Record<string, unknown>;
  if (typeof phrase.id !== "string" || !phrase.id.trim()) throw new Error(`Checkpoint phrase ${index + 1} has a malformed ID`);
  if (typeof phrase.english !== "string" || !phrase.english.trim()) throw new Error(`Checkpoint phrase ${index + 1} has malformed English`);
  if (typeof phrase.chinese !== "string" || !phrase.chinese.trim()) throw new Error(`Checkpoint phrase ${index + 1} has malformed Chinese`);
  if (typeof phrase.contentVersion !== "string" || !phrase.contentVersion.trim()) throw new Error(`Checkpoint phrase ${index + 1} has malformed contentVersion`);
  if (typeof phrase.qualityVersion !== "string" || !phrase.qualityVersion.trim()) throw new Error(`Checkpoint phrase ${index + 1} has malformed qualityVersion`);
}

export async function loadQwenCheckpoint(options: LoadOptions): Promise<QwenCheckpoint> {
  const parsed = JSON.parse(await readFile(options.path, "utf8")) as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Checkpoint is malformed");
  if (parsed.version !== options.version) throw new Error(`Checkpoint version does not match ${options.version}`);
  if (!Array.isArray(parsed.phrases)) throw new Error("Checkpoint phrases must be an array");

  const expectedFingerprint = sourceSha256(options.sourceContent);
  if (parsed.sourceSha256 !== undefined && parsed.sourceSha256 !== expectedFingerprint) throw new Error("Checkpoint source fingerprint does not match");
  const sourceById = new Map(options.sourceContent.phrases.map((phrase) => [phrase.id, phrase]));
  const seen = new Set<string>();
  const phrases: SystemContentPhrase[] = [];
  for (const [index, value] of parsed.phrases.entries()) {
    validatePhrase(value, index);
    if (seen.has(value.id)) throw new Error(`Checkpoint contains duplicate ID: ${value.id}`);
    seen.add(value.id);
    const sourcePhrase = sourceById.get(value.id);
    if (!sourcePhrase) throw new Error(`Checkpoint contains unknown ID: ${value.id}`);
    const actualMetadata = canonical(immutableMetadata(value as unknown as Record<string, unknown>));
    const expectedMetadata = canonical(immutableMetadata(sourcePhrase as unknown as Record<string, unknown>));
    if (actualMetadata !== expectedMetadata) throw new Error(`Checkpoint immutable metadata drift for ID: ${value.id}`);
    phrases.push(value);
  }
  return { version: options.version, sourceSha256: expectedFingerprint, phrases };
}

export async function importQwenCheckpoint(options: ImportOptions): Promise<{ count: number; destination: string }> {
  const checkpoint = await loadQwenCheckpoint({ path: options.source, version: options.version, sourceContent: options.sourceContent });
  const serialized = `${JSON.stringify(checkpoint)}\n`;
  try {
    const existing = await loadQwenCheckpoint({ path: options.destination, version: options.version, sourceContent: options.sourceContent });
    if (canonical(existing) === canonical(checkpoint)) return { count: checkpoint.phrases.length, destination: options.destination };
    throw new Error(`Checkpoint conflict: destination already exists at ${options.destination}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  await mkdir(dirname(options.destination), { recursive: true });
  const pending = `${options.destination}.pending`;
  let pendingCreated = false;
  let pendingFile: Awaited<ReturnType<typeof open>> | undefined;
  try {
    try {
      pendingFile = await open(pending, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") await rm(pending, { force: true });
      throw error;
    }
    pendingCreated = true;
    await pendingFile.writeFile(serialized, "utf8");
    await pendingFile.close();
    pendingFile = undefined;
    await rename(pending, options.destination);
    pendingCreated = false;
  } finally {
    try {
      await pendingFile?.close();
    } finally {
      if (pendingCreated) await rm(pending, { force: true });
    }
  }
  return { count: checkpoint.phrases.length, destination: options.destination };
}
