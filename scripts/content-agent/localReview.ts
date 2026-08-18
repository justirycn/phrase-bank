import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { validateSystemContentPackage } from "../../app/domain/systemContent";
import type { SystemContentPackage, SystemContentPhrase } from "../../app/domain/types";
import { BLUEPRINTS } from "./catalog";

export type ReviewDecision = "pass" | "issue";

export interface ReviewItem {
  decision: ReviewDecision;
  note: string;
  updatedAt: string;
}

export interface ReviewState {
  format: "phrase-bank-local-review";
  version: string;
  candidateSha256: string;
  sampleSeed: string;
  sampledIds: string[];
  items: Record<string, ReviewItem>;
  approvedAt?: string;
}

export type QualityHintCode = "repeated-opening" | "missing-context" | "placeholder" | "empty" | "language-mismatch";

export interface QualityHint {
  code: QualityHintCode;
  message: string;
}

export interface ReviewModel {
  candidateSha256: string;
  sampledIds: string[];
  sample: SystemContentPhrase[];
  hintsById: Record<string, QualityHint[]>;
  initialState: ReviewState;
  allIds: string[];
}

const CATEGORIES = ["daily", "travel", "work", "business", "supply-chain", "social"] as const;
const BASE_PER_KIND = 5;
const PRIORITY_WORK = 8;
const PRIORITY_SUPPLY = 8;
const PRIORITY_PACKAGING = 4;
// Risk hints are mandatory additions, but capped so a badly generated family cannot turn sampling into a full review.
const HINT_SUPPLEMENT_CAP = 30;
const PLACEHOLDER = /\b(?:xxx|tbd|todo|placeholder)\b/iu;
const CONTEXT_MARKER = /\b(?:regarding|during|before|after|when|while|context|as part of|for)\b/iu;
const HINT_ORDER: QualityHintCode[] = ["empty", "placeholder", "language-mismatch", "repeated-opening", "missing-context"];
const HINT_RISK_ORDER: QualityHintCode[] = ["empty", "placeholder", "language-mismatch", "missing-context", "repeated-opening"];
const CONTEXT_TOKEN_EQUIVALENCES: readonly (readonly string[])[] = [
  ["审核", "审查", "复核"],
  ["规划", "计划"],
  ["确认", "核实"],
];

export function candidateSha256(rawCandidate: string): string {
  return createHash("sha256").update(rawCandidate, "utf8").digest("hex");
}

function ranked(phrases: SystemContentPhrase[], seed: string, scope: string): SystemContentPhrase[] {
  return [...phrases].sort((left, right) => {
    const leftRank = candidateSha256(`${seed}\u0000${scope}\u0000${left.id}`);
    const rightRank = candidateSha256(`${seed}\u0000${scope}\u0000${right.id}`);
    return leftRank.localeCompare(rightRank) || left.id.localeCompare(right.id);
  });
}

function translatedSubcategories(): Map<string, string> {
  return new Map(BLUEPRINTS.flatMap(({ id, families }) => families.flatMap(({ subcategory, subcategoryZh }) =>
    subcategoryZh ? [[`${id}:${subcategory}`, subcategoryZh] as const] : [])));
}

function normalizedWords(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function containsNormalizedPhrase(value: string, phrase: string): boolean {
  return ` ${normalizedWords(value)} `.includes(` ${normalizedWords(phrase)} `);
}

function containsTranslatedContext(chinese: string, expected: string): boolean {
  const compactChinese = normalizedWords(chinese).replaceAll(" ", "");
  let variants = new Set([expected]);
  for (const equivalents of CONTEXT_TOKEN_EQUIVALENCES) {
    const expanded = new Set<string>();
    for (const variant of variants) {
      const token = equivalents.find((candidate) => variant.includes(candidate));
      if (!token) expanded.add(variant);
      else for (const replacement of equivalents) expanded.add(variant.replaceAll(token, replacement));
    }
    variants = expanded;
  }
  return [...variants].some((variant) => compactChinese.includes(normalizedWords(variant).replaceAll(" ", "")));
}

function normalizedOpening(english: string): string {
  const normalized = english.normalize("NFKC").toLocaleLowerCase("en-US");
  const comma = normalized.indexOf(",");
  if (comma >= 0) return normalizedWords(normalized.slice(0, comma));
  return (normalized.match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 5).join(" ");
}

function repeatedOpeningIds(phrases: SystemContentPhrase[]): Set<string> {
  const groups = new Map<string, SystemContentPhrase[]>();
  for (const phrase of phrases) {
    if (!phrase.english.trim()) continue;
    const opening = normalizedOpening(phrase.english);
    if (!opening) continue;
    const key = `${phrase.categoryId}\u0000${phrase.subcategory}\u0000${opening}`;
    groups.set(key, [...(groups.get(key) ?? []), phrase]);
  }
  return new Set([...groups.values()].filter((group) => group.length >= 4).flatMap((group) => group.map(({ id }) => id)));
}

function buildHints(phrases: SystemContentPhrase[]): Record<string, QualityHint[]> {
  const contextualZh = translatedSubcategories();
  const repeated = repeatedOpeningIds(phrases);
  const result: Record<string, QualityHint[]> = {};

  for (const phrase of phrases) {
    const hints = new Map<QualityHintCode, string>();
    const english = phrase.english.trim();
    const chinese = phrase.chinese.trim();
    const emptyFields = [!english && "英文", !chinese && "中文"].filter(Boolean).join("和");
    if (emptyFields) hints.set("empty", `${emptyFields}内容为空，请补充完整。`);
    if (PLACEHOLDER.test(english.normalize("NFKC")) || PLACEHOLDER.test(chinese.normalize("NFKC"))) {
      hints.set("placeholder", "检测到占位文字，请替换为可发布的真实表达。 ");
    }
    if ((english && !/\p{Script=Latin}/u.test(english)) || (chinese && !/\p{Script=Han}/u.test(chinese))) {
      hints.set("language-mismatch", "英文或中文字段的语言可能填反，请核对双语内容。 ");
    }
    if (repeated.has(phrase.id)) hints.set("repeated-opening", "同一主题中至少四条短语使用了机械重复的开头，建议改写句型。 ");

    const expectedContext = contextualZh.get(`${phrase.categoryId}:${phrase.subcategory}`);
    const hanLength = (chinese.match(/\p{Script=Han}/gu) ?? []).length;
    const englishWords = english.match(/\p{Script=Latin}+(?:'\p{Script=Latin}+)?/gu)?.length ?? 0;
    const obviouslyMissingContext = englishWords >= 9 && hanLength <= 3 && CONTEXT_MARKER.test(english.normalize("NFKC"));
    const omittedCatalogContext = expectedContext
      && containsNormalizedPhrase(english, phrase.subcategory)
      && !containsTranslatedContext(chinese, expectedContext);
    if (omittedCatalogContext || obviouslyMissingContext) {
      hints.set("missing-context", "中文译文可能遗漏了英文中的场景或主题信息，请对照补全上下文。 ");
    }

    result[phrase.id] = HINT_ORDER.flatMap((code) => {
      const message = hints.get(code);
      return message ? [{ code, message: message.trim() }] : [];
    });
  }
  return result;
}

function addSelected(target: Map<string, SystemContentPhrase>, choices: SystemContentPhrase[], count: number): void {
  let added = 0;
  for (const phrase of choices) {
    if (target.has(phrase.id)) continue;
    target.set(phrase.id, phrase);
    added += 1;
    if (added === count) return;
  }
}

export function validateReviewableContent(value: unknown): SystemContentPackage {
  if (!value || typeof value !== "object" || !("phrases" in value) || !Array.isArray(value.phrases)) {
    throw new Error("Candidate content must contain a phrases array");
  }
  const validationCopy = structuredClone(value) as { phrases: unknown[] };
  for (const [index, phrase] of validationCopy.phrases.entries()) {
    if (!phrase || typeof phrase !== "object" || Array.isArray(phrase)) throw new Error(`Candidate phrase ${index} must be an object`);
    const fields = phrase as Record<string, unknown>;
    if (typeof fields.english !== "string" || typeof fields.chinese !== "string") {
      throw new Error(`Candidate phrase ${index} English and Chinese text must be strings`);
    }
    const sentinelKey = `${index}-${String(fields.id ?? "missing-id")}`;
    if (!fields.english.trim()) fields.english = `local-review-empty-english-${sentinelKey}`;
    if (!fields.chinese.trim()) fields.chinese = `本地审阅空中文${sentinelKey}`;
  }

  const validated = validateSystemContentPackage(validationCopy as SystemContentPackage);
  if (validated.phrases.length !== 2000) throw new Error(`Candidate content count must be 2000, got ${validated.phrases.length}`);
  const coreCount = validated.phrases.filter(({ kind }) => kind === "core").length;
  if (coreCount !== 600) throw new Error(`Candidate core count must be 600, got ${coreCount}`);
  return structuredClone(value) as SystemContentPackage;
}

export function buildReviewModel(options: { content: SystemContentPackage; candidateRaw: string; sampleSeed: string }): ReviewModel {
  const { content, candidateRaw, sampleSeed } = options;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidateRaw);
  } catch (error) {
    throw new Error("Candidate raw is not valid JSON", { cause: error });
  }
  let candidateContent: SystemContentPackage;
  try {
    candidateContent = validateReviewableContent(parsed);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown validation error";
    throw new Error(`Candidate content is not a valid system content package: ${reason}`, { cause: error });
  }
  if (!isDeepStrictEqual(candidateContent, content)) throw new Error("Candidate raw content does not match the supplied content");

  const allPhrases = [...candidateContent.phrases].sort((left, right) => left.id.localeCompare(right.id));
  const allIds = allPhrases.map(({ id }) => id);
  const hintsById = buildHints(allPhrases);
  const selected = new Map<string, SystemContentPhrase>();

  for (const categoryId of CATEGORIES) {
    const category = allPhrases.filter((phrase) => phrase.categoryId === categoryId);
    for (const kind of ["core", "example"] as const) {
      addSelected(selected, ranked(category.filter((phrase) => phrase.kind === kind), sampleSeed, `base:${categoryId}:${kind}`), BASE_PER_KIND);
    }
  }

  addSelected(selected, ranked(allPhrases.filter(({ subcategory }) => subcategory === "packaging review"), sampleSeed, "priority:packaging"), PRIORITY_PACKAGING);
  addSelected(selected, ranked(allPhrases.filter(({ categoryId }) => categoryId === "work"), sampleSeed, "priority:work"), PRIORITY_WORK);
  addSelected(selected, ranked(allPhrases.filter(({ categoryId }) => categoryId === "supply-chain"), sampleSeed, "priority:supply"), PRIORITY_SUPPLY);

  const hinted = allPhrases.filter(({ id }) => hintsById[id].length > 0).sort((left, right) => {
    const risk = (phrase: SystemContentPhrase) => Math.min(...hintsById[phrase.id].map(({ code }) => HINT_RISK_ORDER.indexOf(code)));
    return risk(left) - risk(right) || left.id.localeCompare(right.id);
  });
  addSelected(selected, hinted, HINT_SUPPLEMENT_CAP);

  const sample = [...selected.values()];
  const sampledIds = sample.map(({ id }) => id);
  const hash = candidateSha256(candidateRaw);
  return {
    candidateSha256: hash,
    sampledIds,
    sample,
    hintsById,
    allIds,
    initialState: {
      format: "phrase-bank-local-review",
      version: candidateContent.version,
      candidateSha256: hash,
      sampleSeed,
      sampledIds: [...sampledIds],
      items: {},
    },
  };
}

function validIdSet(validIds: Iterable<string>): Set<string> {
  return validIds instanceof Set ? validIds : new Set(validIds);
}

function hasUnsafeControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0)!;
    return (code < 32 && code !== 9 && code !== 10) || (code >= 127 && code <= 159);
  });
}

export function decideReviewItem(
  state: ReviewState,
  options: {
    candidateSha256: string;
    validIds: Iterable<string>;
    id: string;
    decision: ReviewDecision;
    note: string;
    now?: string;
  },
): ReviewState {
  if (options.candidateSha256 !== state.candidateSha256) throw new Error("Candidate hash drift prevents this review decision");
  if (!validIdSet(options.validIds).has(options.id)) throw new Error(`Unknown candidate ID: ${options.id}`);
  if (options.decision !== "pass" && options.decision !== "issue") throw new Error("Invalid review decision");
  if (options.note.length > 1000) throw new Error("Review note exceeds 1000 UTF-16 code units");
  if (hasUnsafeControl(options.note)) throw new Error("Review note contains an unsafe control character");

  const unapproved = { ...state };
  delete unapproved.approvedAt;
  return {
    ...unapproved,
    items: {
      ...state.items,
      [options.id]: {
        decision: options.decision,
        note: options.note.trim(),
        updatedAt: options.now ?? new Date().toISOString(),
      },
    },
  };
}

export function approveReview(
  state: ReviewState,
  options: { candidateSha256: string; version: string; expectedSampledIds: readonly string[]; now?: string },
): ReviewState {
  if (options.candidateSha256 !== state.candidateSha256) throw new Error("Candidate hash drift prevents approval");
  if (options.version !== state.version) throw new Error("Candidate version drift prevents approval");
  if (options.expectedSampledIds.length === 0) throw new Error("Expected sample must not be empty");
  if (new Set(options.expectedSampledIds).size !== options.expectedSampledIds.length) throw new Error("Expected sample IDs must be unique");
  if (state.sampledIds.length !== options.expectedSampledIds.length
    || state.sampledIds.some((id, index) => id !== options.expectedSampledIds[index])) {
    throw new Error("Review sample does not match the expected sample");
  }
  const undecided = options.expectedSampledIds.find((id) => state.items[id]?.decision !== "pass");
  if (undecided) throw new Error(`Sampled ID is undecided or not passed: ${undecided}`);
  const issue = Object.entries(state.items).find(([, item]) => item.decision === "issue");
  if (issue) throw new Error(`Review contains an unresolved issue: ${issue[0]}`);
  return { ...state, items: { ...state.items }, approvedAt: options.now ?? new Date().toISOString() };
}
