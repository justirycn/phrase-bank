import { expect, request, test, type Browser, type Page } from "@playwright/test";
import type { BackupEnvelopeV5, Phrase, PhraseLearningState } from "../../app/domain/types";
import { BUNDLED_SYSTEM_CONTENT_VERSION } from "../../app/domain/bundledSystemContent";

const credentials = { username: "e2e", password: "browser-test-password" };
const now = "2026-08-24T01:00:00.000Z";
const due = "2026-08-23T01:00:00.000Z";

function systemPhrase(id: string, english: string, extra: Partial<Phrase> = {}): Phrase {
  return {
    id, english, chinese: `测试：${english}`, categoryId: "daily", origin: "system", kind: "core",
    subcategory: "routine", cefrLevel: "A2", intent: "handle a daily situation",
    contentVersion: BUNDLED_SYSTEM_CONTENT_VERSION, qualityVersion: "e2e",
    personalExample: "", sourceNote: "", reviewStep: 0, masteryLevel: 0,
    nextReviewAt: due, createdAt: now, updatedAt: now, ...extra,
  };
}

function state(phraseId: string, extra: Partial<PhraseLearningState> = {}): PhraseLearningState {
  return { phraseId, stage: "unseen", consecutiveGood: 0, masteredDates: [], updatedAt: now, ...extra };
}

function regressionSnapshot(): BackupEnvelopeV5 {
  const lockedParent = systemPhrase("locked-parent", "Could you show me where it is?");
  const lockedExample = systemPhrase("locked-example", "Could you point me in the right direction?", {
    kind: "example", parentPhraseId: lockedParent.id, unlockOrder: 1,
  });
  const retired = systemPhrase("retired-due", "This retired sentence must not be reviewed.", { retiredAt: now });
  const reviewReady = systemPhrase("review-ready", "I could use a quick review.", {
    masteryLevel: 3, nextReviewAt: "2099-01-01T00:00:00.000Z", lastReviewedAt: now,
  });
  const fresh = Array.from({ length: 5 }, (_, index) => systemPhrase(`fresh-${index + 1}`, `This is fresh sentence number ${index + 1}.`));
  const phrases = [lockedParent, lockedExample, retired, reviewReady, ...fresh];
  return {
    format: "personal-phrase-bank", version: 5, exportedAt: now,
    categories: [{ id: "daily", name: "日常", isDefault: true, createdAt: now, updatedAt: now }],
    phrases, reviewLogs: [], trainingEvents: [], trainingSessions: [], learningSessions: [],
    phraseLearningStates: [
      state(lockedParent.id, { unlockedAt: now }),
      state(lockedExample.id, { stage: "learned", firstSeenAt: now, firstTestedAt: now, firstResult: "good" }),
      state(retired.id, { stage: "learned", firstSeenAt: now, firstTestedAt: now, firstResult: "good", unlockedAt: now }),
      state(reviewReady.id, { stage: "learned", firstSeenAt: now, firstTestedAt: now, firstResult: "good", unlockedAt: now }),
      ...fresh.map((phrase) => state(phrase.id, { unlockedAt: now })),
    ],
    activeSystemContentVersion: BUNDLED_SYSTEM_CONTENT_VERSION,
    appPreferences: { dailyMasteryGoal: 10, dailyNewPhraseGoal: 10 },
    speechPreferences: { accent: "en-US", autoSpeak: false },
  };
}

async function resetCloudSnapshot(baseURL: string) {
  const api = await request.newContext({ baseURL });
  const login = await api.post("/api/auth/login", { data: credentials });
  expect(login.ok()).toBeTruthy();
  const current = await api.get("/api/repository");
  const { revision } = await current.json() as { revision: number };
  const saved = await api.put("/api/repository", {
    headers: { "x-document-revision": String(revision) },
    data: { snapshot: regressionSnapshot() },
  });
  expect(saved.ok(), `${saved.status()} ${await saved.text()}`).toBeTruthy();
  await api.dispose();
}

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("账号").fill(credentials.username);
  await page.getByLabel("密码").fill(credentials.password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("button", { name: /继续今日任务/ })).toBeVisible();
}

async function signedInPages(browser: Browser) {
  const phone = await browser.newContext();
  const computer = await browser.newContext();
  const phonePage = await phone.newPage();
  const computerPage = await computer.newPage();
  await Promise.all([login(phonePage), login(computerPage)]);
  return { phone, computer, phonePage, computerPage };
}

test.beforeEach(async ({ baseURL }) => {
  await resetCloudSnapshot(baseURL!);
});

test("real account flow does not loop between preparing and an empty group", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("button", { name: /今日新句 0 \/ 10 · 还差 5 句/ })).toBeVisible();
  await page.getByRole("button", { name: /继续今日任务/ }).click();
  await expect(page.getByText("今日任务 · 新句学习")).toBeVisible();
  await expect(page.getByText("1 / 5")).toBeVisible();
  await page.waitForTimeout(3_000);
  await expect(page.getByText("今日任务 · 新句学习")).toBeVisible();
  await expect(page.getByText("正在准备今天的语言块…")).toHaveCount(0);
  await expect(page.getByText("这一组完成了")).toHaveCount(0);
});

test("proactive review stays available before the daily new-phrase task", async ({ page }) => {
  await login(page);
  const entry = page.getByRole("button", { name: /^主动复习/ });
  await expect(entry).toBeEnabled();
  await expect(entry).toContainText("随机复习 1 句 · 随时可练");
  await expect(page.getByRole("button", { name: /^自主学习/ })).toBeDisabled();

  await entry.click();
  await expect(page.getByText("主动复习 · 中文回忆")).toBeVisible();
  await expect(page.getByText("测试：I could use a quick review.")).toBeVisible();
  await page.waitForTimeout(3_000);
  await expect(page.getByText("主动复习 · 中文回忆")).toBeVisible();
  await expect(page.getByText("正在准备主动复习内容…")).toHaveCount(0);
});

test("stale phone and computer sessions preserve both users' changes", async ({ browser }) => {
  const sessions = await signedInPages(browser);
  try {
    await sessions.phonePage.getByRole("button", { name: "设置" }).click();
    await sessions.phonePage.getByLabel("每日答对目标").fill("12");
    await sessions.phonePage.getByRole("button", { name: "保存每日目标" }).click();
    await expect(sessions.phonePage.getByText("每日目标已保存")).toBeVisible();

    await sessions.computerPage.getByRole("button", { name: "添加" }).click();
    await sessions.computerPage.getByLabel("英文表达").fill("I saved this on my computer.");
    await sessions.computerPage.getByLabel("中文含义").fill("这是我在电脑上保存的。");
    await sessions.computerPage.getByRole("button", { name: "保存语言块" }).click();
    await expect(sessions.computerPage.getByRole("heading", { name: "我的句子" })).toBeVisible();
    await expect(sessions.computerPage.getByText("I saved this on my computer.")).toBeVisible();

    await sessions.phonePage.reload();
    await expect(sessions.phonePage.getByRole("button", { name: /继续今日任务/ })).toBeVisible();
    await sessions.phonePage.getByRole("button", { name: "设置" }).click();
    await expect(sessions.phonePage.getByLabel("每日答对目标")).toHaveValue("12");
    await sessions.phonePage.getByRole("button", { name: "句库" }).click();
    await expect(sessions.phonePage.getByText("I saved this on my computer.")).toBeVisible();
  } finally {
    await Promise.all([sessions.phone.close(), sessions.computer.close()]);
  }
});
