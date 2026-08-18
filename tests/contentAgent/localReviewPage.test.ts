import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { renderLocalReviewPage } from "../../scripts/content-agent/localReviewPage";

const NONCE = "YWJjZGVmMDEyMzQ1Njc4OQ==";
const HASH = "a".repeat(64);

type ReviewPayload = ReturnType<typeof payload>;

function payload() {
  return {
    content: {
      version: "2026.08.18",
      phrases: [
        { id: "daily-core", categoryId: "daily", subcategory: "greetings", kind: "core", english: "Hello.", chinese: "你好。" },
        { id: "daily-example", categoryId: "daily", subcategory: "follow-up", kind: "example", parentPhraseId: "daily-core", english: '<img onerror="attack()">', chinese: "字面标签" },
        { id: "work-issue", categoryId: "work", subcategory: "planning", kind: "core", english: "Plan it.", chinese: "规划它。" },
        { id: "travel-example", categoryId: "travel", subcategory: "airport", kind: "example", parentPhraseId: "travel-core", english: "Where is gate two?", chinese: "二号登机口在哪里？" },
      ],
    },
    report: { status: "pass", coreCount: 600, totalCount: 2000 },
    review: {
      sampledIds: ["daily-core", "daily-example", "travel-example"],
      items: {
        "daily-core": { decision: "pass", note: "", updatedAt: "2026-08-18T00:00:00.000Z" },
        "work-issue": { decision: "issue", note: "fix", updatedAt: "2026-08-18T00:00:00.000Z" },
        "travel-example": { decision: "pass", note: "", updatedAt: "2026-08-18T00:00:00.000Z" },
      },
    },
    candidateSha256: HASH,
    hintsById: { "daily-example": [{ code: "placeholder", message: "需要核对" }] },
    canApprove: false,
  };
}

function response(value: unknown, ok = true, status = ok ? 200 : 409) {
  return { ok, status, json: async () => value };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function boot(fetchMock: ReturnType<typeof vi.fn>) {
  const dom = new JSDOM(renderLocalReviewPage({ nonce: NONCE }), {
    runScripts: "outside-only",
    url: "http://127.0.0.1:43127/",
  });
  Object.assign(dom.window, { fetch: fetchMock, prompt: vi.fn() });
  const script = dom.window.document.querySelector("script[type=module]");
  dom.window.eval(script?.textContent ?? "");
  return dom;
}

function change(dom: JSDOM, id: string, value: string | boolean, event = "input") {
  const control = dom.window.document.getElementById(id) as HTMLInputElement | HTMLSelectElement;
  if (typeof value === "boolean") (control as HTMLInputElement).checked = value;
  else control.value = String(value);
  control.dispatchEvent(new dom.window.Event(event, { bubbles: true }));
}

function rowIds(dom: JSDOM) {
  return [...dom.window.document.querySelectorAll("#review-list article h3")].map((node) => node.textContent);
}

describe("renderLocalReviewPage", () => {
  it("returns a complete zh-CN page with the nonce on its only style and module script", () => {
    const html = renderLocalReviewPage({ nonce: NONCE });

    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('<html lang="zh-CN">');
    expect(html).toContain(`<style nonce="${NONCE}">`);
    expect(html).toContain(`<script type="module" nonce="${NONCE}">`);
    expect(html.match(/<style\b/g)).toHaveLength(1);
    expect(html.match(/<script\b/g)).toHaveLength(1);
  });

  it.each(["", "unsafe nonce", "bad\"nonce", "<script>", "abc=def", "a".repeat(257)])(
    "rejects unsafe nonce %j",
    (nonce) => expect(() => renderLocalReviewPage({ nonce })).toThrow(/nonce/i),
  );

  it("contains the review summary, filters, semantic regions, and approval action", () => {
    const html = renderLocalReviewPage({ nonce: NONCE });

    for (const text of [
      "本地 Qwen 句库审核", "版本", "核心句", "600", "总句数", "2000", "报告", "门禁",
      "候选哈希", "审核状态", "抽样", "通过", "问题", "未决定", "搜索", "分类", "子分类",
      "类型", "仅看抽样", "仅看问题", "仅看提示", "清除筛选", "批准此版本", "重新加载", "加载更多",
    ]) expect(html).toContain(text);
    expect(html).toContain('<main id="main-content"');
    expect(html).toContain('role="status"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('id="sample-only" type="checkbox" checked');
    expect(html).toContain('id="approve" type="button" aria-describedby="approval-help" disabled');
    expect(html).toContain('id="review-list"');
    expect(html).toContain('id="load-more" type="button" aria-describedby="result-count" hidden');
    expect(html).toContain("document.createElement(\"article\")");
  });

  it("keeps candidate fields read-only and renders all candidate data through safe DOM APIs", () => {
    const html = renderLocalReviewPage({ nonce: NONCE });

    expect(html).not.toMatch(/contenteditable/i);
    expect(html).not.toContain(".innerHTML");
    expect(html).not.toContain("insertAdjacentHTML");
    expect(html).not.toContain("document.write");
    expect(html).toContain("english.textContent = phrase.english");
    expect(html).toContain("chinese.textContent = phrase.chinese");
    expect(html).toContain('english.lang = "en"');
    expect(html).toContain('chinese.lang = "zh-CN"');
    expect(html).toContain('note.maxLength = 1000');
    expect(html).toContain('note.setAttribute("aria-label"');
    expect(html).not.toMatch(/<textarea[\s\S]*?<textarea/i);
    expect(html).not.toMatch(/<input[^>]+(?:english|chinese)/i);
  });

  it("uses only the three relative JSON API endpoints and exact mutation payload names", () => {
    const html = renderLocalReviewPage({ nonce: NONCE });

    expect(html).toContain('fetch("/api/review"');
    expect(html).toContain('fetch("/api/decision"');
    expect(html).toContain('fetch("/api/approve"');
    expect(html).toContain('JSON.stringify({ id, decision, note: submittedNote, candidateSha256: model.candidateSha256 })');
    expect(html).toContain('JSON.stringify({ version: model.version, candidateSha256: model.candidateSha256 })');
    expect(html).toContain('window.prompt("请输入要批准的确切版本号：", "")');
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/\/api\/(?:publish|deploy|git|upload)/i);
    expect(html).not.toMatch(/\bon\w+\s*=/i);
    expect(html).not.toContain("eval(");
  });

  it("implements loading, explicit retry, recoverable pending states, and double-submit guards", () => {
    const html = renderLocalReviewPage({ nonce: NONCE });

    expect(html).toContain("正在加载审核数据");
    expect(html).toContain("加载失败");
    expect(html).toContain('retryButton.hidden = false');
    expect(html).toContain('retryButton.addEventListener("click", loadReview)');
    expect(html).toContain("if (!model || approvalPending || pendingIds.size > 0) return");
    expect(html).toContain("pendingIds.add(id)");
    expect(html).toContain("pendingIds.delete(id)");
    expect(html).toContain("pendingNotes.set(id, submittedNote)");
    expect(html).toContain("pendingNotes.delete(id)");
    expect(html).toContain("approvalPending");
    expect(html).toContain("if (!model || approvalPending || pendingIds.size > 0 || !approvalEnabled) return");
    expect(html).not.toMatch(/setInterval|setTimeout\s*\(\s*loadReview/);
  });

  it("derives options, searches all required fields, counts decisions, and preserves source order", () => {
    const html = renderLocalReviewPage({ nonce: NONCE });

    expect(html).toContain("new Set(model.phrases.map((phrase) => phrase.categoryId))");
    expect(html).toContain("phrase.subcategory");
    expect(html).toContain("phrase.parentPhraseId");
    expect(html).toContain("phrase.english");
    expect(html).toContain("phrase.chinese");
    expect(html).toContain("phrase.id");
    expect(html).toContain("model.phrases.filter");
    expect(html).toContain("const PAGE_SIZE = 100");
    expect(html).toContain("searchTextById = new Map(phrases.map");
    expect(html).toContain("searchTextById.get(phrase.id)");
    expect(html).not.toContain(".sort(");
    expect(html).toContain('decision === "pass"');
    expect(html).toContain('decision === "issue"');
  });

  it("normalizes the upcoming server payload without server-rendering candidate data", () => {
    const html = renderLocalReviewPage({ nonce: NONCE });

    expect(html).toContain("payload.content && Array.isArray(payload.content.phrases)");
    expect(html).toContain("payload.review && payload.review.items");
    expect(html).toContain("payload.review && payload.review.sampledIds");
    expect(html).toContain("payload.content && payload.content.version");
    expect(html).toContain("payload.report && payload.report.coreCount");
    expect(html).toContain("payload.report && payload.report.totalCount");
    expect(html).toContain("payload.review && payload.review.approvedAt");
  });

  it("includes responsive, reflow, focus, touch-target, overflow, and reduced-motion safeguards", () => {
    const html = renderLocalReviewPage({ nonce: NONCE });

    expect(html).toMatch(/max-width:\s*100%/);
    expect(html).toMatch(/overflow-wrap:\s*anywhere/);
    expect(html).toMatch(/min-height:\s*44px/);
    expect(html).toMatch(/\.filters \.check \{[^}]*min-height:\s*44px/);
    expect(html).toMatch(/:focus-visible/);
    expect(html).toMatch(/scroll-margin-top/);
    expect(html).toMatch(/padding-bottom/);
    expect(html).toMatch(/@media\s*\(max-width:\s*700px\)/);
    expect(html).toMatch(/grid-template-columns:\s*1fr/);
    expect(html).toMatch(/#load-more\s*\{[^}]*min-height:\s*44px/);
    expect(html).toMatch(/@media\s*\(max-width:\s*700px\)[\s\S]*#load-more\s*\{[^}]*width:\s*100%/);
    expect(html).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(html).not.toMatch(/position:\s*fixed/);
  });
});

describe("local review page runtime", () => {
  it("bounds a 2,000-phrase result set, loads pages, and searches beyond the first page", async () => {
    const large = payload();
    large.content.phrases = Array.from({ length: 2000 }, (_, index) => ({
      id: `phrase-${String(index).padStart(4, "0")}`,
      categoryId: index % 2 === 0 ? "daily" : "work",
      subcategory: index % 2 === 0 ? "common" : "planning",
      kind: index % 3 === 0 ? "core" : "example",
      parentPhraseId: index % 3 === 0 ? undefined : `phrase-${String(index - (index % 3)).padStart(4, "0")}`,
      english: index === 1999 ? "Unique final audit phrase" : `English phrase ${index}`,
      chinese: `中文短语 ${index}`,
    })) as typeof large.content.phrases;
    large.review.sampledIds = ["phrase-0000", "phrase-0001", "phrase-0002"];
    large.review.items = Object.fromEntries(large.review.sampledIds.map((id) => [
      id, { decision: "pass", note: "", updatedAt: "2026-08-18T00:00:00.000Z" },
    ])) as typeof large.review.items;
    large.canApprove = true;
    const approved = structuredClone(large);
    (approved.review as typeof approved.review & { approvedAt?: string }).approvedAt = "2026-08-18T03:00:00.000Z";
    approved.canApprove = false;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(large))
      .mockResolvedValueOnce(response(large))
      .mockResolvedValueOnce(response(approved));
    const dom = boot(fetchMock);
    await vi.waitFor(() => expect(rowIds(dom)).toHaveLength(3));

    (dom.window.document.getElementById("sample-only") as HTMLInputElement).click();
    expect(rowIds(dom)).toHaveLength(100);
    expect(dom.window.document.getElementById("result-count")?.textContent).toBe("显示 100 / 2000 条");
    const loadMore = dom.window.document.getElementById("load-more") as HTMLButtonElement;
    expect(loadMore.hidden).toBe(false);
    expect(loadMore.disabled).toBe(false);
    loadMore.click();
    expect(rowIds(dom)).toHaveLength(200);
    expect(dom.window.document.getElementById("result-count")?.textContent).toBe("显示 200 / 2000 条");
    const pass = [...dom.window.document.querySelectorAll("#phrase-phrase-0150 button")]
      .find((button) => button.textContent === "通过") as HTMLButtonElement;
    pass.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const approveButton = dom.window.document.getElementById("approve") as HTMLButtonElement;
    await vi.waitFor(() => expect(approveButton.disabled).toBe(false));
    await vi.waitFor(() => expect(rowIds(dom)).toHaveLength(200));
    expect(rowIds(dom)).toContain("phrase-0150");
    expect(dom.window.document.getElementById("result-count")?.textContent).toBe("显示 200 / 2000 条");

    const prompt = dom.window.prompt as ReturnType<typeof vi.fn>;
    prompt.mockReturnValueOnce("2026.08.18");
    approveButton.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(dom.window.document.getElementById("approved-value")?.textContent).toBe("已批准"));
    await vi.waitFor(() => expect(rowIds(dom)).toHaveLength(200));
    expect(dom.window.document.getElementById("result-count")?.textContent).toBe("显示 200 / 2000 条");

    change(dom, "category", "daily", "change");
    expect(rowIds(dom)).toHaveLength(100);
    expect(dom.window.document.getElementById("result-count")?.textContent).toBe("显示 100 / 1000 条");

    change(dom, "search", "phrase-1999");
    expect(rowIds(dom)).toEqual([]);
    change(dom, "category", "", "change");
    expect(rowIds(dom)).toEqual(["phrase-1999"]);
    expect(dom.window.document.getElementById("result-count")?.textContent).toBe("显示 1 / 1 条");
    expect(loadMore.hidden).toBe(true);
    dom.window.document.getElementById("clear-filters")?.click();
    expect(rowIds(dom).length).toBeLessThanOrEqual(100);
    expect(dom.window.document.getElementById("result-count")?.textContent).toBe("显示 3 / 3 条");
  }, 15_000);

  it("renders the nested payload safely and derives concrete blockers including non-sampled issues", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(payload()));
    const dom = boot(fetchMock);

    await vi.waitFor(() => expect(rowIds(dom)).toEqual(["daily-core", "daily-example", "travel-example"]));
    expect(dom.window.document.getElementById("version-value")?.textContent).toBe("2026.08.18");
    expect(dom.window.document.getElementById("core-count")?.textContent).toBe("600");
    expect(dom.window.document.getElementById("total-count")?.textContent).toBe("2000");
    expect(dom.window.document.getElementById("pass-count")?.textContent).toBe("2");
    expect(dom.window.document.getElementById("issue-count")?.textContent).toBe("1");
    expect(dom.window.document.getElementById("undecided-count")?.textContent).toBe("1");
    const help = dom.window.document.getElementById("approval-help")?.textContent;
    expect(help).toContain("work-issue");
    expect(help).toContain("daily-example");
    const hostile = dom.window.document.querySelector("#phrase-daily-example [lang=en]");
    expect(hostile?.textContent).toBe('<img onerror="attack()">');
    expect(hostile?.querySelector("img")).toBeNull();
  });

  it("bounds blocker ID details and reports the remaining count", async () => {
    const many = payload();
    const issueItems = Object.fromEntries(Array.from({ length: 22 }, (_, index) => [
      `issue-${String(index).padStart(2, "0")}`,
      { decision: "issue", note: "", updatedAt: "2026-08-18T00:00:00.000Z" },
    ]));
    many.review.items = issueItems as typeof many.review.items;
    const dom = boot(vi.fn().mockResolvedValue(response(many)));

    await vi.waitFor(() => expect(dom.window.document.getElementById("approval-help")?.textContent).toContain("另有 2 条"));
    const help = dom.window.document.getElementById("approval-help")?.textContent;
    expect(help).toContain("issue-00");
    expect(help).toContain("issue-19");
    expect(help).not.toContain("issue-20");
    expect(help).toContain("daily-core");
    expect(help).toContain("daily-example");
    expect(help).toContain("travel-example");
  });

  it("applies every filter and clear deterministically", async () => {
    const dom = boot(vi.fn().mockResolvedValue(response(payload())));
    await vi.waitFor(() => expect(rowIds(dom)).toHaveLength(3));

    change(dom, "search", "daily-core");
    expect(rowIds(dom)).toEqual(["daily-core", "daily-example"]);
    change(dom, "search", "");
    change(dom, "category", "travel", "change");
    expect(rowIds(dom)).toEqual(["travel-example"]);
    change(dom, "category", "daily", "change");
    change(dom, "subcategory", "follow-up", "change");
    expect(rowIds(dom)).toEqual(["daily-example"]);
    change(dom, "subcategory", "", "change");
    change(dom, "kind", "core", "change");
    expect(rowIds(dom)).toEqual(["daily-core"]);
    dom.window.document.getElementById("clear-filters")?.click();
    change(dom, "sample-only", false, "change");
    change(dom, "issue-only", true, "change");
    expect(rowIds(dom)).toEqual(["work-issue"]);
    change(dom, "issue-only", false, "change");
    change(dom, "hint-only", true, "change");
    expect(rowIds(dom)).toEqual(["daily-example"]);
    dom.window.document.getElementById("clear-filters")?.click();
    expect(rowIds(dom)).toEqual(["daily-core", "daily-example", "travel-example"]);
  });

  it("renders once for one checkbox activation", async () => {
    const dom = boot(vi.fn().mockResolvedValue(response(payload())));
    await vi.waitFor(() => expect(rowIds(dom)).toHaveLength(3));
    const list = dom.window.document.getElementById("review-list") as HTMLDivElement;
    const replaceChildren = list.replaceChildren.bind(list);
    let renders = 0;
    list.replaceChildren = (...nodes: (Node | string)[]) => {
      renders += 1;
      replaceChildren(...nodes);
    };

    (dom.window.document.getElementById("sample-only") as HTMLInputElement).click();
    expect(renders).toBe(1);
  });

  it("posts the current note once while pending and clears a failed-decision alert after retry succeeds", async () => {
    const firstSave = deferred<ReturnType<typeof response>>();
    const secondSave = deferred<ReturnType<typeof response>>();
    const updated = payload();
    updated.review.items["daily-example"] = { decision: "pass", note: "服务器备注", updatedAt: "2026-08-18T01:00:00.000Z" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(payload()))
      .mockReturnValueOnce(firstSave.promise)
      .mockResolvedValueOnce(response({ error: "保存失败" }, false))
      .mockReturnValueOnce(secondSave.promise);
    const dom = boot(fetchMock);
    await vi.waitFor(() => expect(rowIds(dom)).toHaveLength(3));

    const note = dom.window.document.getElementById("note-daily-example") as HTMLTextAreaElement;
    note.value = "当前备注";
    const otherNote = dom.window.document.getElementById("note-travel-example") as HTMLTextAreaElement;
    otherNote.value = "其他草稿";
    otherNote.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    const pass = [...dom.window.document.querySelectorAll("#phrase-daily-example button")]
      .find((button) => button.textContent === "通过") as HTMLButtonElement;
    pass.click();
    pass.click();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      id: "daily-example", decision: "pass", note: "当前备注", candidateSha256: HASH,
    });
    expect((dom.window.document.getElementById("note-daily-example") as HTMLTextAreaElement).disabled).toBe(true);
    expect((dom.window.document.getElementById("note-daily-example") as HTMLTextAreaElement).value).toBe("当前备注");
    expect((dom.window.document.getElementById("note-travel-example") as HTMLTextAreaElement).value).toBe("其他草稿");
    expect((dom.window.document.getElementById("note-travel-example") as HTMLTextAreaElement).disabled).toBe(true);
    const otherPass = [...dom.window.document.querySelectorAll("#phrase-travel-example button")]
      .find((button) => button.textContent === "通过") as HTMLButtonElement;
    otherPass.disabled = false;
    otherPass.click();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    change(dom, "search", "daily-example");
    expect((dom.window.document.getElementById("note-daily-example") as HTMLTextAreaElement).value).toBe("当前备注");
    expect((dom.window.document.getElementById("note-daily-example") as HTMLTextAreaElement).disabled).toBe(true);
    change(dom, "search", "");
    firstSave.resolve(response(updated));
    await vi.waitFor(() => expect(dom.window.document.getElementById("pass-count")?.textContent).toBe("3"));
    expect((dom.window.document.getElementById("note-daily-example") as HTMLTextAreaElement).value).toBe("服务器备注");
    expect((dom.window.document.getElementById("note-travel-example") as HTMLTextAreaElement).value).toBe("其他草稿");
    expect((dom.window.document.getElementById("note-travel-example") as HTMLTextAreaElement).disabled).toBe(false);

    const current = dom.window.document.getElementById("note-daily-example") as HTMLTextAreaElement;
    current.value = "失败后保留";
    const issue = [...dom.window.document.querySelectorAll("#phrase-daily-example button")]
      .find((button) => button.textContent === "标记问题") as HTMLButtonElement;
    issue.click();
    await vi.waitFor(() => expect(dom.window.document.getElementById("page-error")?.textContent).toContain("保存 daily-example 失败"));
    expect((dom.window.document.getElementById("note-daily-example") as HTMLTextAreaElement).value).toBe("失败后保留");
    expect((dom.window.document.getElementById("note-daily-example") as HTMLTextAreaElement).disabled).toBe(false);
    expect((dom.window.document.getElementById("note-travel-example") as HTMLTextAreaElement).disabled).toBe(false);

    const retry = [...dom.window.document.querySelectorAll("#phrase-daily-example button")]
      .find((button) => button.textContent === "通过") as HTMLButtonElement;
    retry.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(dom.window.document.getElementById("page-error")?.hidden).toBe(true);
    expect(dom.window.document.getElementById("page-error")?.textContent).toBe("");
    secondSave.resolve(response(updated));
    await vi.waitFor(() => expect((dom.window.document.getElementById("note-daily-example") as HTMLTextAreaElement).value)
      .toBe("服务器备注"));
    change(dom, "search", "daily-example");
    expect((dom.window.document.getElementById("note-daily-example") as HTMLTextAreaElement).value).toBe("服务器备注");
    await vi.waitFor(() => expect(dom.window.document.getElementById("page-error")?.hidden).toBe(true));
    expect(dom.window.document.getElementById("page-error")?.textContent).toBe("");
  });

  it("requires the exact version, guards pending approval, and gives approved state precedence", async () => {
    const ready = payload();
    ready.review.items["daily-example"] = { decision: "pass", note: "", updatedAt: "2026-08-18T01:00:00.000Z" };
    ready.review.items["work-issue"] = { decision: "pass", note: "resolved", updatedAt: "2026-08-18T01:00:00.000Z" };
    ready.canApprove = true;
    const approved: ReviewPayload = structuredClone(ready);
    (approved.review as typeof approved.review & { approvedAt?: string }).approvedAt = "2026-08-18T02:00:00.000Z";
    approved.canApprove = false;
    const approval = deferred<ReturnType<typeof response>>();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(ready))
      .mockReturnValueOnce(approval.promise)
      .mockReturnValue(new Promise(() => undefined));
    const dom = boot(fetchMock);
    await vi.waitFor(() => expect((dom.window.document.getElementById("approve") as HTMLButtonElement).disabled).toBe(false));
    const prompt = dom.window.prompt as ReturnType<typeof vi.fn>;
    prompt.mockReturnValueOnce("wrong");
    dom.window.document.getElementById("approve")?.click();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    prompt.mockReturnValueOnce("2026.08.18");
    const button = dom.window.document.getElementById("approve") as HTMLButtonElement;
    button.click();
    button.click();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ version: "2026.08.18", candidateSha256: HASH });
    expect(button.disabled).toBe(true);
    const pendingNote = dom.window.document.getElementById("note-daily-example") as HTMLTextAreaElement;
    expect(pendingNote.disabled).toBe(true);
    const forcedDecision = [...dom.window.document.querySelectorAll("#phrase-daily-example button")]
      .find((control) => control.textContent === "标记问题") as HTMLButtonElement;
    forcedDecision.disabled = false;
    forcedDecision.click();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    approval.resolve(response(approved));
    await vi.waitFor(() => expect(dom.window.document.getElementById("approval-help")?.textContent)
      .toBe("当前候选已批准，等待独立发布命令。"));
    expect(dom.window.document.getElementById("approved-value")?.textContent).toBe("已批准");
    expect(dom.window.document.getElementById("approval-status")?.textContent).toBe("版本已批准。");
    expect((dom.window.document.getElementById("approve") as HTMLButtonElement).disabled).toBe(true);
    expect((dom.window.document.getElementById("note-daily-example") as HTMLTextAreaElement).disabled).toBe(false);
  });

  it("refuses approval when derived blockers contradict canApprove", async () => {
    const inconsistent = payload();
    inconsistent.review.items["daily-example"] = { decision: "pass", note: "", updatedAt: "2026-08-18T01:00:00.000Z" };
    inconsistent.canApprove = true;
    const fetchMock = vi.fn().mockResolvedValue(response(inconsistent));
    const dom = boot(fetchMock);

    await vi.waitFor(() => expect(dom.window.document.getElementById("approval-help")?.textContent).toContain("work-issue"));
    const approve = dom.window.document.getElementById("approve") as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    approve.click();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("blocks approval during decisions and re-enables only after a clean pass response", async () => {
    const ready = payload();
    ready.review.items["daily-example"] = { decision: "pass", note: "", updatedAt: "2026-08-18T01:00:00.000Z" };
    ready.review.items["work-issue"] = { decision: "pass", note: "resolved", updatedAt: "2026-08-18T01:00:00.000Z" };
    ready.canApprove = true;
    const withIssue = structuredClone(ready);
    withIssue.review.items["daily-example"] = { decision: "issue", note: "check", updatedAt: "2026-08-18T02:00:00.000Z" };
    withIssue.canApprove = false;
    const issueSave = deferred<ReturnType<typeof response>>();
    const passSave = deferred<ReturnType<typeof response>>();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(ready))
      .mockReturnValueOnce(issueSave.promise)
      .mockReturnValueOnce(passSave.promise);
    const dom = boot(fetchMock);
    await vi.waitFor(() => expect((dom.window.document.getElementById("approve") as HTMLButtonElement).disabled).toBe(false));

    const issue = [...dom.window.document.querySelectorAll("#phrase-daily-example button")]
      .find((button) => button.textContent === "标记问题") as HTMLButtonElement;
    issue.click();
    const approve = dom.window.document.getElementById("approve") as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    expect(dom.window.document.getElementById("approval-help")?.textContent).toBe("正在等待 1 条审核决定保存完成。");
    approve.disabled = false;
    approve.click();
    expect(dom.window.prompt).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    issueSave.resolve(response(withIssue));
    await vi.waitFor(() => expect(dom.window.document.getElementById("approval-help")?.textContent).toContain("daily-example"));
    expect((dom.window.document.getElementById("approve") as HTMLButtonElement).disabled).toBe(true);
    const pass = [...dom.window.document.querySelectorAll("#phrase-daily-example button")]
      .find((button) => button.textContent === "通过") as HTMLButtonElement;
    pass.click();
    expect((dom.window.document.getElementById("approve") as HTMLButtonElement).disabled).toBe(true);
    expect(dom.window.document.getElementById("approval-help")?.textContent).toBe("正在等待 1 条审核决定保存完成。");
    passSave.resolve(response(ready));
    await vi.waitFor(() => expect((dom.window.document.getElementById("approve") as HTMLButtonElement).disabled).toBe(false));
    expect(dom.window.document.getElementById("approval-help")?.textContent).toBe("所有批准条件均已满足，可以批准当前版本。");
  });

  it("shows a retry after initial GET failure and clears the alert when retry succeeds", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ error: "bad" }, false, 500))
      .mockResolvedValueOnce(response(payload()));
    const dom = boot(fetchMock);
    await vi.waitFor(() => expect((dom.window.document.getElementById("retry") as HTMLButtonElement).hidden).toBe(false));
    expect(dom.window.document.getElementById("page-error")?.textContent).toContain("加载失败");
    dom.window.document.getElementById("retry")?.click();
    await vi.waitFor(() => expect(rowIds(dom)).toHaveLength(3));
    expect(dom.window.document.getElementById("page-error")?.hidden).toBe(true);
    expect(dom.window.document.getElementById("page-error")?.textContent).toBe("");
  });
});
