import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isDeepStrictEqual } from "node:util";
import type { SystemContentPackage } from "../../app/domain/types";
import { approveReview, buildReviewModel, decideReviewItem, type ReviewState } from "./localReview";
import { renderLocalReviewPage } from "./localReviewPage";
import { createLocalReviewStore, type SaveReviewDependencies } from "./localReviewStore";
import { inspectSystemContent } from "./qualityGate";

const LOOPBACK_HOST = "127.0.0.1";
const MAX_BODY_BYTES = 32_768;
const REPORT_KEYS = new Set(["status", "version", "coreCount", "totalCount", "coreByCategory", "errors"]);

interface QualityReport {
  status: "pass";
  version: string;
  coreCount: number;
  totalCount: number;
  coreByCategory: Record<string, number>;
  errors: string[];
}

export interface StartLocalReviewServerOptions {
  candidatePath: string;
  reportPath: string;
  reviewPath: string;
  host: string;
  port: number;
  sampleSeed: string;
  storeDependencies?: Omit<SaveReviewDependencies, "validIds">;
  now?: () => string;
}

export interface LocalReviewServer {
  host: string;
  url: string;
  close(): Promise<void>;
}

class HttpError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 405 | 409, message: string) { super(message); }
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value: Record<string, unknown>, required: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === required.length && required.every((key) => Object.hasOwn(value, key));
}

function parseReport(raw: string, content: SystemContentPackage): QualityReport {
  if (duplicateJsonKeys(raw)) throw new Error("Quality report contains duplicate JSON keys");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("Quality report is not valid JSON"); }
  if (!plainRecord(value) || Object.keys(value).some((key) => !REPORT_KEYS.has(key)) || !exactKeys(value, [...REPORT_KEYS])) {
    throw new Error("Quality report has an invalid shape");
  }
  const inspected = inspectSystemContent(content);
  const expected = { status: "pass", version: content.version, ...inspected };
  if (inspected.errors.length || inspected.coreCount !== 600 || inspected.totalCount !== 2000 || !isDeepStrictEqual(value, expected)) {
    throw new Error("Quality report does not match the deterministic candidate inspection");
  }
  return value as unknown as QualityReport;
}

function securityHeaders(response: ServerResponse): void {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  securityHeaders(response);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

function duplicateJsonKeys(raw: string): boolean {
  class DuplicateKey extends Error {}
  let index = 0;
  const whitespace = () => { while (/\s/u.test(raw[index] ?? "")) index += 1; };
  const string = (): string => {
    const start = index++;
    while (index < raw.length) {
      if (raw[index] === "\\") { index += 2; continue; }
      if (raw[index++] === "\"") return JSON.parse(raw.slice(start, index)) as string;
    }
    throw new SyntaxError("Unterminated JSON string");
  };
  const value = (): void => {
    whitespace();
    if (raw[index] === "{") { object(); return; }
    if (raw[index] === "[") { array(); return; }
    if (raw[index] === "\"") { string(); return; }
    const start = index;
    while (index < raw.length && !/[\s,\]}]/u.test(raw[index])) index += 1;
    if (index === start) throw new SyntaxError("Invalid JSON value");
  };
  const object = (): void => {
    index += 1;
    whitespace();
    if (raw[index] === "}") { index += 1; return; }
    const keys = new Set<string>();
    while (index < raw.length) {
      whitespace();
      if (raw[index] !== "\"") throw new SyntaxError("Invalid JSON object key");
      const key = string();
      if (keys.has(key)) throw new DuplicateKey();
      keys.add(key);
      whitespace();
      if (raw[index++] !== ":") throw new SyntaxError("Invalid JSON object separator");
      value();
      whitespace();
      if (raw[index] === "}") { index += 1; return; }
      if (raw[index++] !== ",") throw new SyntaxError("Invalid JSON object delimiter");
    }
    throw new SyntaxError("Unterminated JSON object");
  };
  const array = (): void => {
    index += 1;
    whitespace();
    if (raw[index] === "]") { index += 1; return; }
    while (index < raw.length) {
      value();
      whitespace();
      if (raw[index] === "]") { index += 1; return; }
      if (raw[index++] !== ",") throw new SyntaxError("Invalid JSON array delimiter");
    }
    throw new SyntaxError("Unterminated JSON array");
  };
  try { value(); return false; } catch (error) { return error instanceof DuplicateKey; }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers["content-type"];
  if (typeof contentType !== "string" || !/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/iu.test(contentType)) {
    throw new HttpError(400, "Content-Type must be application/json");
  }
  const lengthHeader = request.headers["content-length"];
  if (lengthHeader !== undefined) {
    if (!/^\d+$/u.test(lengthHeader) || Number(lengthHeader) > MAX_BODY_BYTES) throw new HttpError(400, "Request body is too large");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  await new Promise<void>((resolve, reject) => {
    request.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(new HttpError(400, "Request body is too large"));
        request.resume();
      } else chunks.push(chunk);
    });
    request.on("end", resolve);
    request.on("aborted", () => reject(new HttpError(400, "Request was aborted")));
    request.on("error", reject);
  });
  let raw: string;
  try { raw = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); }
  catch { throw new HttpError(400, "Request body must be UTF-8"); }
  if (duplicateJsonKeys(raw)) throw new HttpError(400, "Duplicate JSON keys are not allowed");
  try { return JSON.parse(raw) as unknown; }
  catch { throw new HttpError(400, "Request body is not valid JSON"); }
}

function decisionBody(value: unknown): { id: string; decision: "pass" | "issue"; note: string; candidateSha256: string } {
  const keys = ["id", "decision", "note", "candidateSha256"];
  if (!plainRecord(value) || !exactKeys(value, keys) || typeof value.id !== "string"
    || (value.decision !== "pass" && value.decision !== "issue") || typeof value.note !== "string"
    || typeof value.candidateSha256 !== "string") throw new HttpError(400, "Decision body has an invalid shape");
  return value as ReturnType<typeof decisionBody>;
}

function approvalBody(value: unknown): { version: string; candidateSha256: string } {
  const keys = ["version", "candidateSha256"];
  if (!plainRecord(value) || !exactKeys(value, keys) || typeof value.version !== "string" || typeof value.candidateSha256 !== "string") {
    throw new HttpError(400, "Approval body has an invalid shape");
  }
  return value as ReturnType<typeof approvalBody>;
}

function canApprove(review: ReviewState, sampledIds: readonly string[]): boolean {
  if (review.approvedAt) return false;
  try {
    approveReview(review, { candidateSha256: review.candidateSha256, version: review.version, expectedSampledIds: sampledIds, now: "2000-01-01T00:00:00.000Z" });
    return true;
  } catch { return false; }
}

export async function startLocalReviewServer(options: StartLocalReviewServerOptions): Promise<LocalReviewServer> {
  if (options.host !== LOOPBACK_HOST) throw new Error(`Local review host must be exactly ${LOOPBACK_HOST}`);
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535) throw new Error("Local review port is invalid");
  const [candidateBytes, reportRaw] = await Promise.all([readFile(options.candidatePath), readFile(options.reportPath, "utf8")]);
  let candidateRaw: string;
  try { candidateRaw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(candidateBytes); }
  catch { throw new Error("Candidate must be valid UTF-8"); }
  if (duplicateJsonKeys(candidateRaw)) throw new Error("Candidate contains duplicate JSON keys");
  let parsedCandidate: unknown;
  try { parsedCandidate = JSON.parse(candidateRaw); } catch { throw new Error("Candidate is not valid JSON"); }
  const model = buildReviewModel({ content: parsedCandidate as SystemContentPackage, candidateRaw, sampleSeed: options.sampleSeed });
  const rawByteSha256 = createHash("sha256").update(candidateBytes).digest("hex");
  if (model.candidateSha256 !== rawByteSha256) throw new Error("Candidate raw-byte hash binding failed");
  const report = parseReport(reportRaw, parsedCandidate as SystemContentPackage);
  const store = await createLocalReviewStore({
    path: options.reviewPath,
    version: report.version,
    candidateSha256: model.candidateSha256,
    sampleSeed: options.sampleSeed,
    sampledIds: model.sampledIds,
    validIds: model.allIds,
  }, options.storeDependencies);
  const content = structuredClone(parsedCandidate) as SystemContentPackage;
  const nonce = randomBytes(24).toString("base64url");
  const page = renderLocalReviewPage({ nonce });
  let expectedHost = "";
  let origin = "";

  const payload = async () => {
    const review = await store.read();
    return { content, report, review, candidateSha256: model.candidateSha256, hintsById: model.hintsById, canApprove: canApprove(review, model.sampledIds) };
  };

  const server = createServer(async (request, response) => {
    try {
      if (request.headers.host !== expectedHost) throw new HttpError(403, "Forbidden host");
      const requestUrl = new URL(request.url ?? "/", origin);
      const mutating = request.method === "POST";
      if (mutating && request.headers.origin !== undefined && request.headers.origin !== origin) throw new HttpError(403, "Forbidden origin");

      if (request.method === "GET" && requestUrl.pathname === "/") {
        securityHeaders(response);
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.setHeader("Referrer-Policy", "no-referrer");
        response.setHeader("X-Frame-Options", "DENY");
        response.setHeader("Content-Security-Policy", `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
        response.end(page);
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/review") { sendJson(response, 200, await payload()); return; }
      if (request.method === "POST" && requestUrl.pathname === "/api/decision") {
        const body = decisionBody(await readJsonBody(request));
        let review: ReviewState;
        try {
          review = await store.update((current) => decideReviewItem(current, { ...body, validIds: model.allIds, now: options.now?.() }));
        } catch (error) {
          if (error instanceof Error && /Candidate hash drift|Unknown candidate ID|Invalid review decision|Review note/u.test(error.message)) throw new HttpError(409, "Review decision conflicts with current state");
          throw error;
        }
        sendJson(response, 200, { ...(await payload()), review, canApprove: canApprove(review, model.sampledIds) });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/approve") {
        const body = approvalBody(await readJsonBody(request));
        let review: ReviewState;
        try {
          review = await store.update((current) => approveReview(current, { ...body, expectedSampledIds: model.sampledIds, now: options.now?.() }));
        } catch (error) {
          if (error instanceof Error && /drift|Expected sample|Review sample|Sampled ID|unresolved issue/u.test(error.message)) throw new HttpError(409, "Approval conflicts with current state");
          throw error;
        }
        sendJson(response, 200, { ...(await payload()), review, canApprove: false });
        return;
      }
      const knownPath = ["/", "/api/review", "/api/decision", "/api/approve"].includes(requestUrl.pathname);
      if (knownPath) response.setHeader("Allow", requestUrl.pathname === "/" || requestUrl.pathname === "/api/review" ? "GET" : "POST");
      throw new HttpError(knownPath ? 405 : 404, knownPath ? "Method not allowed" : "Not found");
    } catch (error) {
      if (response.headersSent || response.writableEnded) { response.destroy(); return; }
      if (error instanceof HttpError) sendJson(response, error.status, { error: error.message });
      else sendJson(response, 500, { error: "Internal server error" });
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => { server.off("listening", onListening); reject(error); };
    const onListening = () => { server.off("error", onError); resolve(); };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(options.port, LOOPBACK_HOST);
  });
  const address = server.address();
  if (!address || typeof address === "string") { server.close(); throw new Error("Local review server did not bind an IPv4 port"); }
  expectedHost = `${LOOPBACK_HOST}:${address.port}`;
  origin = `http://${expectedHost}`;
  let closing: Promise<void> | undefined;
  return {
    host: LOOPBACK_HOST,
    url: origin,
    close() {
      closing ??= new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      return closing;
    },
  };
}
