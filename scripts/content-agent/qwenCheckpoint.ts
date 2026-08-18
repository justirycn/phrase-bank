import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { SystemContentPackage, SystemContentPhrase } from "../../app/domain/types";

export interface QwenCheckpoint {
  version: string;
  sourceSha256: string;
  generatedAt?: string;
  phrases: SystemContentPhrase[];
}

interface LoadOptions {
  path: string;
  version: string;
  sourceContent: SystemContentPackage;
}

interface ValidateOptions {
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
const CONTENT_VERSION_PATTERN = /^[0-9]{4}\.[0-9]{2}\.[0-9]+$/;

export function assertContentVersion(version: unknown): string {
  if (typeof version !== "string" || !CONTENT_VERSION_PATTERN.test(version)) throw new Error("Content version must use YYYY.MM.N with digits only");
  return version;
}

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

export function validateQwenCheckpoint(value: unknown, options: ValidateOptions): QwenCheckpoint {
  assertContentVersion(options.version);
  const parsed = value as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Checkpoint is malformed");
  if (parsed.version !== options.version) throw new Error(`Checkpoint version does not match ${options.version}`);
  if (!Array.isArray(parsed.phrases)) throw new Error("Checkpoint phrases must be an array");
  let generatedAt: string | undefined;
  if (parsed.generatedAt !== undefined) {
    if (typeof parsed.generatedAt !== "string" || !parsed.generatedAt.trim()) throw new Error("Checkpoint generatedAt is malformed");
    const parsedDate = new Date(parsed.generatedAt);
    if (Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString() !== parsed.generatedAt) throw new Error("Checkpoint generatedAt is malformed");
    generatedAt = parsed.generatedAt;
  }

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
    if (options.sourceContent.phrases[index]?.id !== value.id) throw new Error(`Checkpoint phrases must be an exact ordered source prefix at index ${index + 1}`);
    const actualMetadata = canonical(immutableMetadata(value as unknown as Record<string, unknown>));
    const expectedMetadata = canonical(immutableMetadata(sourcePhrase as unknown as Record<string, unknown>));
    if (actualMetadata !== expectedMetadata) throw new Error(`Checkpoint immutable metadata drift for ID: ${value.id}`);
    phrases.push(value);
  }
  return generatedAt === undefined
    ? { version: options.version, sourceSha256: expectedFingerprint, phrases }
    : { version: options.version, sourceSha256: expectedFingerprint, generatedAt, phrases };
}

export async function loadQwenCheckpoint(options: LoadOptions): Promise<QwenCheckpoint> {
  return validateQwenCheckpoint(JSON.parse(await readFile(options.path, "utf8")), options);
}

export async function importQwenCheckpoint(options: ImportOptions): Promise<{ count: number; destination: string }> {
  const checkpoint = await loadQwenCheckpoint({ path: options.source, version: options.version, sourceContent: options.sourceContent });
  const serialized = `${JSON.stringify(checkpoint)}\n`;
  await mkdir(dirname(options.destination), { recursive: true });
  const pending = `${options.destination}.pending.${process.pid}.${randomUUID()}`;
  let pendingCreated = false;
  try {
    const pendingFile = await open(pending, "wx");
    pendingCreated = true;
    try {
      await pendingFile.writeFile(serialized, "utf8");
    } finally {
      await pendingFile.close();
    }
    try {
      await link(pending, options.destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await loadCommittedDestination(options);
      if (canonical(existing) !== canonical(checkpoint)) throw new Error(`Checkpoint conflict: destination already exists at ${options.destination}`);
    }
    return { count: checkpoint.phrases.length, destination: options.destination };
  } finally {
    if (pendingCreated) await rm(pending, { force: true });
  }
}

async function loadCommittedDestination(options: ImportOptions): Promise<QwenCheckpoint> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await loadQwenCheckpoint({ path: options.destination, version: options.version, sourceContent: options.sourceContent });
    } catch (error) {
      lastError = error;
      if (!new Set(["ENOENT", "EACCES", "EPERM"]).has((error as NodeJS.ErrnoException).code ?? "") || attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw lastError;
}
