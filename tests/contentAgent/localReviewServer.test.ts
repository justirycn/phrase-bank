import { request, type ClientRequest } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateSystemContent } from "../../scripts/content-agent/generator";
import { inspectSystemContent } from "../../scripts/content-agent/qualityGate";
import { buildReviewModel, candidateSha256 } from "../../scripts/content-agent/localReview";
import { startLocalReviewServer } from "../../scripts/content-agent/localReviewServer";
import { createTempRootTracker } from "./tempRoots";

const servers: Array<{ close(): Promise<void> }> = [];
const requests = new Set<ClientRequest>();
const tempRoots = createTempRootTracker();

async function withTimeout<T>(operation: Promise<T>, milliseconds: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms`)), milliseconds); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

afterEach(async () => {
  for (const activeRequest of requests) activeRequest.destroy(new Error("test cleanup cancelled request"));
  requests.clear();
  const closeResults = await Promise.allSettled(servers.splice(0).map((server) => withTimeout(server.close(), 10_000, "local review server cleanup")));
  await tempRoots.cleanup();
  const failedClose = closeResults.find(({ status }) => status === "rejected");
  if (failedClose?.status === "rejected") throw failedClose.reason;
});

async function fixture() {
  const root = await tempRoots.create("phrase-bank-local-review-server-");
  const content = generateSystemContent();
  const candidateRaw = `${JSON.stringify(content, null, 2)}\n`;
  const report = { status: "pass", version: content.version, ...inspectSystemContent(content) };
  const candidatePath = join(root, "candidate.json");
  const reportPath = join(root, "report.json");
  const reviewPath = join(root, "review.json");
  await writeFile(candidatePath, candidateRaw, "utf8");
  await writeFile(reportPath, `${JSON.stringify(report)}\n`, "utf8");
  return { root, content, candidateRaw, report, candidatePath, reportPath, reviewPath, hash: candidateSha256(candidateRaw) };
}

async function start(files: Awaited<ReturnType<typeof fixture>>, overrides: Record<string, unknown> = {}) {
  const server = await startLocalReviewServer({
    candidatePath: files.candidatePath,
    reportPath: files.reportPath,
    reviewPath: files.reviewPath,
    host: "127.0.0.1",
    port: 0,
    sampleSeed: `${files.content.version}:manual-review-v1`,
    ...overrides,
  });
  servers.push(server);
  return server;
}

function raw(url: string, options: { method?: string; path?: string; headers?: Record<string, string>; body?: Buffer | string; chunked?: boolean } = {}) {
  const endpoint = new URL(options.path ?? "/", url);
  const body = typeof options.body === "string" ? Buffer.from(options.body) : options.body;
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((resolveResult, reject) => {
    const req = request(endpoint, { method: options.method, headers: { ...(body && !options.chunked ? { "Content-Length": String(body.length) } : {}), ...options.headers } }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolveResult({ status: response.statusCode!, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    requests.add(req);
    req.once("close", () => requests.delete(req));
    req.setTimeout(30_000, () => req.destroy(new Error("local review test request timed out")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function post(url: string, path: string, value: unknown, headers: Record<string, string> = {}) {
  return raw(url, { method: "POST", path, body: JSON.stringify(value), headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
}

describe("local review HTTP server", () => {
  it("rejects a non-loopback host before reading files", async () => {
    await expect(startLocalReviewServer({ candidatePath: "missing-candidate", reportPath: "missing-report", reviewPath: "missing-review", host: "localhost", port: 0, sampleSeed: "seed" }))
      .rejects.toThrow(/127\.0\.0\.1/);
  });

  it("rejects malformed, mismatched, and tampered startup inputs before listening", async () => {
    const files = await fixture();
    await writeFile(files.reportPath, "{", "utf8");
    await expect(start(files)).rejects.toThrow(/report/i);
    await writeFile(files.reportPath, JSON.stringify({ ...files.report, version: "wrong" }), "utf8");
    await expect(start(files)).rejects.toThrow(/report/i);
    await writeFile(files.reportPath, JSON.stringify({ ...files.report, totalCount: 1999 }), "utf8");
    await expect(start(files)).rejects.toThrow(/report/i);
    const duplicateReport = JSON.stringify(files.report).replace('"status":"pass"', '"status":"pass","status":"pass"');
    await writeFile(files.reportPath, duplicateReport, "utf8");
    await expect(start(files)).rejects.toThrow(/report/i);
    await writeFile(files.reportPath, JSON.stringify(files.report), "utf8");
    const tampered = structuredClone(files.content);
    tampered.phrases[1].english = tampered.phrases[0].english;
    await writeFile(files.candidatePath, JSON.stringify(tampered), "utf8");
    await expect(start(files)).rejects.toThrow(/quality|report/i);
  });

  it("rejects duplicate candidate keys and invalid candidate UTF-8 before listening", async () => {
    const files = await fixture();
    const firstId = files.content.phrases[0].id;
    const duplicate = files.candidateRaw.replace(`"id": "${firstId}"`, `"id": "${firstId}",\n      "id": "${firstId}"`);
    await writeFile(files.candidatePath, duplicate, "utf8");
    await expect(start(files)).rejects.toThrow(/candidate.*duplicate/i);

    await writeFile(files.candidatePath, Buffer.concat([Buffer.from(files.candidateRaw.slice(0, 20)), Buffer.from([0xc3, 0x28]), Buffer.from(files.candidateRaw.slice(20))]));
    await expect(start(files)).rejects.toThrow(/candidate.*utf-8/i);
  });

  it("serves a nonce-bound static page with locked-down headers", async () => {
    const files = await fixture();
    const server = await start(files);
    const response = await raw(server.url);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^text\/html; charset=utf-8$/i);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    const csp = String(response.headers["content-security-policy"]);
    const nonce = csp.match(/script-src 'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeTruthy();
    expect(csp).toContain(`style-src 'nonce-${nonce}'`);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("img-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).not.toContain("*");
    expect(csp).not.toMatch(/https?:|data:|blob:/u);
    expect(response.body).toContain(`nonce="${nonce}"`);
    expect(response.body).not.toMatch(/https?:\/\//);
  });

  it("serves the nested 2,000-item review payload", async () => {
    const files = await fixture();
    const server = await start(files);
    const response = await raw(server.url, { path: "/api/review" });
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    const payload = JSON.parse(response.body);
    expect(Object.keys(payload).sort()).toEqual(["canApprove", "candidateSha256", "content", "hintsById", "report", "review"].sort());
    expect(payload.content.phrases).toHaveLength(2000);
    expect(payload.report).toEqual(files.report);
    expect(payload.candidateSha256).toBe(files.hash);
    expect(payload.canApprove).toBe(false);
  }, 20_000);

  it("persists exact decisions and rejects stale, unknown, extra, and duplicate-key mutations", async () => {
    const files = await fixture();
    const server = await start(files);
    const review = JSON.parse((await raw(server.url, { path: "/api/review" })).body);
    const id = review.review.sampledIds[0];
    const good = await post(server.url, "/api/decision", { id, decision: "pass", note: " checked ", candidateSha256: files.hash });
    expect(good.status).toBe(200);
    expect(JSON.parse(good.body).review.items[id]).toMatchObject({ decision: "pass", note: "checked" });
    expect(JSON.parse(await readFile(files.reviewPath, "utf8")).items[id]).toMatchObject({ decision: "pass", note: "checked" });
    const before = await readFile(files.reviewPath, "utf8");
    for (const value of [
      { id, decision: "issue", note: "x", candidateSha256: "0".repeat(64) },
      { id: "unknown", decision: "pass", note: "", candidateSha256: files.hash },
      { id, decision: "pass", note: "", candidateSha256: files.hash, extra: true },
    ]) expect((await post(server.url, "/api/decision", value)).status).toBe(value === undefined ? 400 : value.candidateSha256 === files.hash && value.id !== "unknown" ? 400 : 409);
    const duplicate = `{"id":"${id}","decision":"issue","note":"x","candidateSha256":"${files.hash}","candidateSha256":"${"0".repeat(64)}"}`;
    expect((await raw(server.url, { method: "POST", path: "/api/decision", body: duplicate, headers: { "Content-Type": "application/json" } })).status).toBe(400);
    expect(await readFile(files.reviewPath, "utf8")).toBe(before);
  }, 20_000);

  it("rejects bad encodings, media types, oversized bodies, foreign Host and foreign Origin", async () => {
    const files = await fixture();
    const server = await start(files);
    expect((await raw(server.url, { method: "POST", path: "/api/decision", body: "{}", headers: { "Content-Type": "text/plain" } })).status).toBe(400);
    expect((await raw(server.url, { method: "POST", path: "/api/decision", body: Buffer.from([0xc3, 0x28]), headers: { "Content-Type": "application/json" } })).status).toBe(400);
    expect((await raw(server.url, { method: "POST", path: "/api/decision", body: "x".repeat(32769), headers: { "Content-Type": "application/json" } })).status).toBe(400);
    expect((await raw(server.url, { method: "POST", path: "/api/decision", body: "x".repeat(32769), chunked: true, headers: { "Content-Type": "application/json" } })).status).toBe(400);
    expect((await raw(server.url, { path: "/api/review", headers: { Host: "evil.invalid" } })).status).toBe(403);
    expect((await raw(server.url, { path: "/api/review", headers: { Host: "127.0.0.1" } })).status).toBe(403);
    const actualPort = Number(new URL(server.url).port);
    expect((await raw(server.url, { path: "/api/review", headers: { Host: `127.0.0.1:${actualPort + 1}` } })).status).toBe(403);
    expect((await post(server.url, "/api/decision", {}, { Origin: "http://evil.invalid" })).status).toBe(403);
  });

  it("accepts an exact 32,768-byte JSON body and an exact same-Origin mutation", async () => {
    const files = await fixture();
    const server = await start(files);
    const payload = JSON.parse((await raw(server.url, { path: "/api/review" })).body);
    const value = { id: payload.review.sampledIds[0], decision: "pass", note: "boundary", candidateSha256: files.hash };
    const json = JSON.stringify(value);
    const body = `${json}${" ".repeat(32_768 - Buffer.byteLength(json))}`;
    expect(Buffer.byteLength(body)).toBe(32_768);
    const response = await raw(server.url, { method: "POST", path: "/api/decision", body, headers: { "Content-Type": "application/json", Origin: server.url } });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body).review.items[value.id]).toMatchObject({ decision: "pass", note: "boundary" });
  });

  it("does not mutate state when a JSON request is aborted mid-body", async () => {
    const files = await fixture();
    const server = await start(files);
    const payload = JSON.parse((await raw(server.url, { path: "/api/review" })).body);
    const body = JSON.stringify({ id: payload.review.sampledIds[0], decision: "pass", note: "", candidateSha256: files.hash });
    const before = await readFile(files.reviewPath, "utf8");

    await withTimeout(new Promise<void>((resolveAbort) => {
      const req = request(new URL("/api/decision", server.url), {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)), Origin: server.url },
      });
      requests.add(req);
      req.once("close", () => requests.delete(req));
      req.on("error", () => resolveAbort());
      req.on("close", () => resolveAbort());
      req.on("socket", (socket) => {
        const sendPartialBody = () => req.write(body.slice(0, 12), () => setImmediate(() => req.destroy()));
        if (socket.connecting) socket.once("connect", sendPartialBody);
        else sendPartialBody();
      });
    }), 10_000, "aborted request cleanup");

    expect((await raw(server.url, { path: "/api/review" })).status).toBe(200);
    expect(await readFile(files.reviewPath, "utf8")).toBe(before);
  }, 20_000);

  it("blocks approval until all sampled IDs pass and no issue exists anywhere, then returns approved state", async () => {
    const files = await fixture();
    const model = buildReviewModel({ content: files.content, candidateRaw: files.candidateRaw, sampleSeed: `${files.content.version}:manual-review-v1` });
    const undecidedId = model.sampledIds[0];
    const preseededItems = Object.fromEntries(model.sampledIds.slice(1).map((id) => [id, { decision: "pass", note: "", updatedAt: "2026-08-18T00:00:00.000Z" }]));
    await writeFile(files.reviewPath, `${JSON.stringify({ ...model.initialState, items: preseededItems })}\n`, "utf8");
    const server = await start(files);
    let payload = JSON.parse((await raw(server.url, { path: "/api/review" })).body);
    const approvalBefore = await readFile(files.reviewPath, "utf8");
    for (const invalid of [
      JSON.stringify({ version: files.content.version, candidateSha256: files.hash, extra: true }),
      JSON.stringify({ version: 1, candidateSha256: files.hash }),
      `{"version":"${files.content.version}","version":"${files.content.version}","candidateSha256":"${files.hash}"}`,
    ]) expect((await raw(server.url, { method: "POST", path: "/api/approve", body: invalid, headers: { "Content-Type": "application/json" } })).status).toBe(400);
    expect(await readFile(files.reviewPath, "utf8")).toBe(approvalBefore);
    expect((await post(server.url, "/api/approve", { version: files.content.version, candidateSha256: files.hash })).status).toBe(409);
    const outside = files.content.phrases.find(({ id }) => !payload.review.sampledIds.includes(id))!.id;
    expect((await post(server.url, "/api/decision", { id: outside, decision: "issue", note: "fix", candidateSha256: files.hash })).status).toBe(200);
    expect((await post(server.url, "/api/decision", { id: undecidedId, decision: "pass", note: "", candidateSha256: files.hash })).status).toBe(200);
    expect((await post(server.url, "/api/approve", { version: files.content.version, candidateSha256: files.hash })).status).toBe(409);
    expect((await post(server.url, "/api/decision", { id: outside, decision: "pass", note: "resolved", candidateSha256: files.hash })).status).toBe(200);
    payload = JSON.parse((await raw(server.url, { path: "/api/review" })).body);
    expect(payload.canApprove).toBe(true);
    const approved = await post(server.url, "/api/approve", { version: files.content.version, candidateSha256: files.hash });
    expect(approved.status).toBe(200);
    const approvedPayload = JSON.parse(approved.body);
    expect(approvedPayload.review.approvedAt).toBeTruthy();
    expect(approvedPayload.canApprove).toBe(false);
    expect(JSON.parse(await readFile(files.reviewPath, "utf8")).approvedAt).toBe(approvedPayload.review.approvedAt);
  }, 30_000);

  it("serializes concurrent decisions without loss and recovers after a failed persisted update", async () => {
    const files = await fixture();
    let failures = 1;
    const server = await start(files, { storeDependencies: { writeTemp: async (path: string, contents: string) => {
      if (failures-- > 0) throw new Error("injected save failure");
      await writeFile(path, contents, "utf8");
    } } });
    const payload = JSON.parse((await raw(server.url, { path: "/api/review" })).body);
    const [first, second] = payload.review.sampledIds;
    expect((await post(server.url, "/api/decision", { id: first, decision: "pass", note: "", candidateSha256: files.hash })).status).toBe(500);
    const results = await Promise.all([first, second].map((id) => post(server.url, "/api/decision", { id, decision: "pass", note: "", candidateSha256: files.hash })));
    expect(results.map(({ status }) => status)).toEqual([200, 200]);
    const state = JSON.parse(await readFile(files.reviewPath, "utf8"));
    expect(Object.keys(state.items)).toEqual(expect.arrayContaining([first, second]));
  }, 20_000);

  it("uses sensible 404/405 responses and releases its port on close", async () => {
    const files = await fixture();
    const server = await start(files);
    expect((await raw(server.url, { path: "/missing" })).status).toBe(404);
    const method = await raw(server.url, { method: "POST", path: "/api/review", body: "{}", headers: { "Content-Type": "application/json" } });
    expect(method.status).toBe(405);
    expect(method.headers.allow).toBe("GET");
    const url = server.url;
    await server.close();
    servers.splice(servers.indexOf(server), 1);
    await expect(raw(url)).rejects.toThrow();
  });
});

describe("local review CLI", () => {
  it("is import-safe and parses only strict valued arguments", async () => {
    const path = resolve("scripts/run-local-content-review.ts");
    const stdout = vi.spyOn(process.stdout, "write");
    try {
      const runner = await import(`${pathToFileURL(path).href}?safe=${Date.now()}`);
      expect(stdout).not.toHaveBeenCalled();
      expect(runner.parseLocalContentReviewArguments(["--version", "2026.08.2"])).toEqual({ version: "2026.08.2", port: 43127 });
      expect(runner.parseLocalContentReviewArguments(["--port", "54321", "--version", "2026.08.2"])).toEqual({ version: "2026.08.2", port: 54321 });
      for (const args of [[], ["--version"], ["--version", "2026.08.2", "--port", "0"], ["--version", "2026.08.2", "--port", "65536"], ["--version", "2026.08.2", "--port", "x"], ["--version", "2026.08.2", "--port", "1", "--port", "2"], ["--version", "2026.08.2", "--wat", "x"]]) expect(() => runner.parseLocalContentReviewArguments(args)).toThrow();
    } finally { stdout.mockRestore(); }
  });

  it("derives fixed local paths and seed and closes once across graceful termination signals", async () => {
    const runner = await import(`${pathToFileURL(resolve("scripts/run-local-content-review.ts")).href}?run=${Date.now()}`);
    const close = vi.fn(async () => undefined);
    const startServer = vi.fn(async () => ({ host: "127.0.0.1", url: "http://127.0.0.1:54321", close }));
    const signals = new Map<string, () => void>();
    const output: string[] = [];
    const setExitCode = vi.fn();
    const repositoryRoot = resolve("test-review-root");

    await runner.runLocalContentReview(["--version", "2026.08.2", "--port", "54321"], {
      repositoryRoot,
      startServer,
      writeOutput: (value: string) => output.push(value),
      onSignal: (signal: string, listener: () => void) => signals.set(signal, listener),
      setExitCode,
    });

    expect(startServer).toHaveBeenCalledWith({
      candidatePath: resolve(repositoryRoot, ".content-agent/candidate-2026.08.2.json"),
      reportPath: resolve(repositoryRoot, ".content-agent/report-2026.08.2.json"),
      reviewPath: resolve(repositoryRoot, ".content-agent/review-2026.08.2.json"),
      host: "127.0.0.1",
      port: 54321,
      sampleSeed: "2026.08.2:manual-review-v1",
    });
    expect(output.join("")).toBe("http://127.0.0.1:54321\nPress Ctrl+C to stop.\n");
    signals.get("SIGINT")?.();
    signals.get("SIGTERM")?.();
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(setExitCode).toHaveBeenCalledWith(0);
  });

  it("handles a rejected close once without leaking its error across competing signals", async () => {
    const runner = await import(`${pathToFileURL(resolve("scripts/run-local-content-review.ts")).href}?close-failure=${Date.now()}`);
    const secret = "private-close-detail";
    const close = vi.fn(async () => { throw new Error(secret); });
    const signals = new Map<string, () => void>();
    const errors: string[] = [];
    const setExitCode = vi.fn();

    await runner.runLocalContentReview(["--version", "2026.08.2"], {
      startServer: vi.fn(async () => ({ host: "127.0.0.1", url: "http://127.0.0.1:43127", close })),
      writeOutput: vi.fn(),
      writeError: (value: string) => errors.push(value),
      onSignal: (signal: string, listener: () => void) => signals.set(signal, listener),
      setExitCode,
    });

    signals.get("SIGTERM")?.();
    signals.get("SIGINT")?.();
    await vi.waitFor(() => expect(setExitCode).toHaveBeenCalledWith(1));
    expect(close).toHaveBeenCalledTimes(1);
    expect(errors).toEqual(["Local review server failed to close.\n"]);
    expect(errors.join("")).not.toContain(secret);
  });
});
