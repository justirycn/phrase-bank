import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SystemContentPackage, SystemContentPhrase } from "../../app/domain/types";
import { generateSystemContent } from "../../scripts/content-agent/generator";
import {
  approveReview,
  buildReviewModel,
  candidateSha256,
  decideReviewItem,
  type QualityHint,
} from "../../scripts/content-agent/localReview";

function candidate(): SystemContentPackage {
  const generated = generateSystemContent();
  return {
    ...generated,
    version: "2026.08.3",
    phrases: generated.phrases.map((phrase) => ({ ...phrase, contentVersion: "2026.08.3" })),
  };
}

function raw(content: SystemContentPackage): string {
  return JSON.stringify(content, null, 2) + "\n";
}

function replacePhrases(content: SystemContentPackage, replacements: Map<string, Partial<SystemContentPhrase>>): SystemContentPackage {
  return {
    ...content,
    phrases: content.phrases.map((phrase) => ({ ...phrase, ...replacements.get(phrase.id) })),
  };
}

function codes(hints: QualityHint[] | undefined): string[] {
  return (hints ?? []).map(({ code }) => code);
}

describe("local phrase review", () => {
  it("hashes the exact UTF-8 candidate string", () => {
    const exact = "候选 {\n  \"version\": \"2026.08.3\"\n}\n";
    const expected = createHash("sha256").update(Buffer.from(exact, "utf8")).digest("hex");

    expect(candidateSha256(exact)).toBe(expected);
    expect(candidateSha256(exact)).toMatch(/^[a-f0-9]{64}$/);
    expect(candidateSha256(exact + " ")).not.toBe(candidateSha256(exact));
  });

  it("builds a reproducible, bounded, representative seeded sample", () => {
    const content = candidate();
    const first = buildReviewModel({ content, candidateRaw: raw(content), sampleSeed: "review-a" });
    const again = buildReviewModel({ content, candidateRaw: raw(content), sampleSeed: "review-a" });
    const other = buildReviewModel({ content, candidateRaw: raw(content), sampleSeed: "review-b" });

    expect(again.sampledIds).toEqual(first.sampledIds);
    expect(other.sampledIds).not.toEqual(first.sampledIds);
    expect(first.sample.map(({ id }) => id)).toEqual(first.sampledIds);
    expect(new Set(first.sampledIds).size).toBe(first.sampledIds.length);
    expect(first.sampledIds.length).toBeLessThan(120);

    for (const categoryId of ["daily", "travel", "work", "business", "supply-chain", "social"]) {
      const categorySample = first.sample.filter((phrase) => phrase.categoryId === categoryId);
      expect(categorySample.length).toBeGreaterThanOrEqual(10);
      expect(new Set(categorySample.map(({ kind }) => kind))).toEqual(new Set(["core", "example"]));
    }

    const allWork = content.phrases.filter(({ categoryId }) => categoryId === "work").length;
    const allSupply = content.phrases.filter(({ categoryId }) => categoryId === "supply-chain").length;
    expect(first.sample.filter(({ categoryId }) => categoryId === "work").length).toBeLessThan(allWork);
    expect(first.sample.filter(({ categoryId }) => categoryId === "supply-chain").length).toBeLessThan(allSupply);
    expect(first.sample.filter(({ subcategory }) => subcategory === "packaging review").length).toBeGreaterThanOrEqual(4);
  });

  it("creates an empty initial review state tied to candidate bytes and version", () => {
    const content = candidate();
    const model = buildReviewModel({ content, candidateRaw: raw(content), sampleSeed: "state-seed" });

    expect(model.allIds).toHaveLength(2000);
    expect(model.initialState).toEqual({
      format: "phrase-bank-local-review",
      version: "2026.08.3",
      candidateSha256: candidateSha256(raw(content)),
      sampleSeed: "state-seed",
      sampledIds: model.sampledIds,
      items: {},
    });
  });

  it("reports deterministic, unique bilingual quality hints over deliberate defects", () => {
    const base = candidate();
    const packagingCores = base.phrases
      .filter(({ categoryId, subcategory, kind }) => categoryId === "supply-chain" && subcategory === "packaging review" && kind === "core")
      .slice(0, 4);
    const replacements = new Map<string, Partial<SystemContentPhrase>>([
      ["sys-daily-01-1-1", { english: "   " }],
      ["sys-daily-01-1-1-e1", { english: "Regarding XXX, TODO placeholder text." }],
      ["sys-daily-01-1-1-e2", { english: "只有中文", chinese: "这是正常中文。" }],
      ["sys-supply-chain-02-2-1", { chinese: "检查。" }],
      ...packagingCores.map((phrase, index) => [phrase.id, {
        english: `Regarding packaging review, inspect distinct item ${index}.`,
        chinese: `关于包装审核，检查不同项目${index}。`,
      }] as [string, Partial<SystemContentPhrase>]),
    ]);
    const content = replacePhrases(base, replacements);
    const model = buildReviewModel({ content, candidateRaw: raw(content), sampleSeed: "hints" });

    expect(codes(model.hintsById["sys-daily-01-1-1"])).toContain("empty");
    expect(codes(model.hintsById["sys-daily-01-1-1-e1"])).toContain("placeholder");
    expect(codes(model.hintsById["sys-daily-01-1-1-e2"])).toContain("language-mismatch");
    expect(codes(model.hintsById["sys-supply-chain-02-2-1"])).toContain("missing-context");
    expect(model.sampledIds).toEqual(expect.arrayContaining([
      "sys-daily-01-1-1",
      "sys-daily-01-1-1-e1",
      "sys-daily-01-1-1-e2",
      "sys-supply-chain-02-2-1",
    ]));
    for (const phrase of packagingCores) {
      const phraseCodes = codes(model.hintsById[phrase.id]);
      expect(phraseCodes).toContain("repeated-opening");
      expect(new Set(phraseCodes).size).toBe(phraseCodes.length);
      expect(model.hintsById[phrase.id].every(({ message }) => /[\u3400-\u9fff]/u.test(message))).toBe(true);
    }
    expect(buildReviewModel({ content, candidateRaw: raw(content), sampleSeed: "hints" }).hintsById).toEqual(model.hintsById);
  });

  it("does not flag four natural openings or valid translated context as mechanical/missing", () => {
    const base = candidate();
    const packagingCores = base.phrases
      .filter(({ categoryId, subcategory, kind }) => categoryId === "supply-chain" && subcategory === "packaging review" && kind === "core")
      .slice(0, 4);
    const openings = [
      "First, let's inspect the packaging carefully.",
      "Could we inspect the packaging together?",
      "Our next packaging step is a careful inspection.",
      "Before shipment, the packaging needs inspection.",
    ];
    const content = replacePhrases(base, new Map(packagingCores.map((phrase, index) => [phrase.id, {
      english: openings[index],
      chinese: `关于包装审核，我们需要仔细检查包装${index}。`,
    }])));
    const model = buildReviewModel({ content, candidateRaw: raw(content), sampleSeed: "natural" });

    for (const phrase of packagingCores) {
      expect(codes(model.hintsById[phrase.id])).not.toContain("repeated-opening");
      expect(codes(model.hintsById[phrase.id])).not.toContain("missing-context");
    }
  });

  it("flags repeated openings and obviously missing context across example records", () => {
    const base = candidate();
    const examples = base.phrases
      .filter(({ categoryId, subcategory, kind }) => categoryId === "supply-chain" && subcategory === "packaging review" && kind === "example")
      .slice(0, 4);
    const shortId = "sys-daily-01-1-1-e1";
    const replacements = new Map<string, Partial<SystemContentPhrase>>(
      examples.slice(0, 4).map((phrase, index) => [phrase.id, {
        english: `Regarding packaging review, we need to inspect contextual item ${index} before shipment.`,
        chinese: "查。",
      }]),
    );
    replacements.set(shortId, { english: "Check it.", chinese: "查。" });
    const content = replacePhrases(base, replacements);
    const model = buildReviewModel({ content, candidateRaw: raw(content), sampleSeed: "example-hints" });

    for (const phrase of examples.slice(0, 4)) {
      expect(codes(model.hintsById[phrase.id])).toEqual(["repeated-opening", "missing-context"]);
    }
    expect(codes(model.hintsById[shortId])).not.toContain("missing-context");
  });

  it("checks catalog translated context across example records", () => {
    const base = candidate();
    const missingId = "sys-supply-chain-02-1-1-e1";
    const translatedId = "sys-supply-chain-02-1-1-e2";
    const contextualEnglish = "Regarding packaging review, please carefully inspect the material specification.";
    const content = replacePhrases(base, new Map([
      [missingId, { english: contextualEnglish, chinese: "请仔细检查材料规格。" }],
      [translatedId, { english: contextualEnglish, chinese: "请在包装审核时仔细检查材料规格。" }],
    ]));
    const model = buildReviewModel({ content, candidateRaw: raw(content), sampleSeed: "example-catalog-context" });

    expect(codes(model.hintsById[missingId])).toContain("missing-context");
    expect(codes(model.hintsById[translatedId])).not.toContain("missing-context");
  });

  it("recognizes non-ASCII Latin letters as English content", () => {
    const base = candidate();
    const content = replacePhrases(base, new Map([
      ["sys-daily-01-1-1-e1", { english: "ÆØÅ.", chinese: "这是有效的双语内容。" }],
    ]));
    const model = buildReviewModel({ content, candidateRaw: raw(content), sampleSeed: "latin-script" });

    expect(codes(model.hintsById["sys-daily-01-1-1-e1"])).not.toContain("language-mismatch");
  });

  it("records an immutable decision for any valid ID and clears approval", () => {
    const content = candidate();
    const model = buildReviewModel({ content, candidateRaw: raw(content), sampleSeed: "decide" });
    const nonSampleId = model.allIds.find((id) => !model.sampledIds.includes(id))!;
    const prior = { ...model.initialState, approvedAt: "2026-08-18T00:00:00.000Z" };

    const decided = decideReviewItem(prior, {
      candidateSha256: model.candidateSha256,
      validIds: model.allIds,
      id: nonSampleId,
      decision: "issue",
      note: "  需要复查\n第二行  ",
      now: "2026-08-18T01:02:03.000Z",
    });

    expect(decided.items[nonSampleId]).toEqual({ decision: "issue", note: "需要复查\n第二行", updatedAt: "2026-08-18T01:02:03.000Z" });
    expect(decided).not.toHaveProperty("approvedAt");
    expect(prior.items).toEqual({});
    expect(prior.approvedAt).toBe("2026-08-18T00:00:00.000Z");
  });

  it("rejects invalid decisions, IDs, hash drift, long notes, and unsafe controls", () => {
    const content = candidate();
    const model = buildReviewModel({ content, candidateRaw: raw(content), sampleSeed: "validation" });
    const common = { candidateSha256: model.candidateSha256, validIds: model.allIds, id: model.allIds[0], decision: "pass" as const, note: "ok" };

    expect(() => decideReviewItem(model.initialState, { ...common, id: "unknown-id" })).toThrow(/unknown/i);
    expect(() => decideReviewItem(model.initialState, { ...common, candidateSha256: "0".repeat(64) })).toThrow(/hash/i);
    expect(() => decideReviewItem(model.initialState, { ...common, decision: "maybe" as "pass" })).toThrow(/decision/i);
    expect(() => decideReviewItem(model.initialState, { ...common, note: "x".repeat(1001) })).toThrow(/1000/);
    expect(() => decideReviewItem(model.initialState, { ...common, note: "bad\u0000note" })).toThrow(/control/i);
    expect(() => decideReviewItem(model.initialState, { ...common, note: "tab\tok\nline" })).not.toThrow();
  });

  it("blocks approval on undecided samples, any issue, hash drift, or version drift", () => {
    const content = candidate();
    const model = buildReviewModel({ content, candidateRaw: raw(content), sampleSeed: "approval-blocks" });
    expect(() => approveReview(model.initialState, { candidateSha256: model.candidateSha256, version: content.version })).toThrow(/undecided/i);

    let state = model.initialState;
    for (const id of model.sampledIds) {
      state = decideReviewItem(state, { candidateSha256: model.candidateSha256, validIds: model.allIds, id, decision: "pass", note: "", now: "2026-08-18T00:00:00.000Z" });
    }
    const nonSampleId = model.allIds.find((id) => !model.sampledIds.includes(id))!;
    state = decideReviewItem(state, { candidateSha256: model.candidateSha256, validIds: model.allIds, id: nonSampleId, decision: "issue", note: "found by search" });

    expect(() => approveReview(state, { candidateSha256: model.candidateSha256, version: content.version })).toThrow(/issue/i);
    expect(() => approveReview({ ...state, items: { ...state.items, [nonSampleId]: { ...state.items[nonSampleId], decision: "pass" } } }, { candidateSha256: "f".repeat(64), version: content.version })).toThrow(/hash/i);
    expect(() => approveReview({ ...state, items: { ...state.items, [nonSampleId]: { ...state.items[nonSampleId], decision: "pass" } } }, { candidateSha256: model.candidateSha256, version: "2026.08.4" })).toThrow(/version/i);
  });

  it("allows issue-to-pass resolution, approves immutably, and refreshes re-approval time", () => {
    const content = candidate();
    const model = buildReviewModel({ content, candidateRaw: raw(content), sampleSeed: "approval-pass" });
    let state = model.initialState;
    for (const id of model.sampledIds) {
      state = decideReviewItem(state, { candidateSha256: model.candidateSha256, validIds: model.allIds, id, decision: "pass", note: "", now: "2026-08-18T00:00:00.000Z" });
    }
    const nonSampleId = model.allIds.find((id) => !model.sampledIds.includes(id))!;
    state = decideReviewItem(state, { candidateSha256: model.candidateSha256, validIds: model.allIds, id: nonSampleId, decision: "issue", note: "check" });
    state = decideReviewItem(state, { candidateSha256: model.candidateSha256, validIds: model.allIds, id: nonSampleId, decision: "pass", note: "resolved" });

    const approved = approveReview(state, { candidateSha256: model.candidateSha256, version: content.version, now: "2026-08-18T03:00:00.000Z" });
    const reapproved = approveReview(approved, { candidateSha256: model.candidateSha256, version: content.version, now: "2026-08-18T04:00:00.000Z" });

    expect(approved.approvedAt).toBe("2026-08-18T03:00:00.000Z");
    expect(reapproved.approvedAt).toBe("2026-08-18T04:00:00.000Z");
    expect(state).not.toHaveProperty("approvedAt");
  });
});
