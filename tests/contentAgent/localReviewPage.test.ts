import { describe, expect, it } from "vitest";
import { renderLocalReviewPage } from "../../scripts/content-agent/localReviewPage";

const NONCE = "YWJjZGVmMDEyMzQ1Njc4OQ==";

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
      "类型", "仅看抽样", "仅看问题", "仅看提示", "清除筛选", "批准此版本", "重新加载",
    ]) expect(html).toContain(text);
    expect(html).toContain('<main id="main-content"');
    expect(html).toContain('role="status"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('id="sample-only" type="checkbox" checked');
    expect(html).toContain('id="approve" type="button" aria-describedby="approval-help" disabled');
    expect(html).toContain('id="review-list"');
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
    expect(html).toContain('JSON.stringify({ id, decision, note: note.value, candidateSha256: model.candidateSha256 })');
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
    expect(html).toContain("pendingIds.has(id)");
    expect(html).toContain("pendingIds.add(id)");
    expect(html).toContain("pendingIds.delete(id)");
    expect(html).toContain("approvalPending");
    expect(html).toContain("if (!model || approvalPending || model.canApprove !== true) return");
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
    expect(html).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(html).not.toMatch(/position:\s*fixed/);
  });
});
