import { expect, test, type Page } from "@playwright/test";
import { feedbackFixture } from "../fixtures/scenarioFeedback";

async function openScenarios(page: Page) {
  await page.goto("/");
  await page.getByLabel("账号").fill("scenario-e2e"); await page.getByLabel("密码").fill("browser-test-password");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("button", { name: /场景口语/ }).click();
  await expect(page.getByText("正在读取练习进度…")).toHaveCount(0);
  await page.getByRole("button", { name: /外贸沟通/ }).click();
  await page.getByRole("button", { name: /寄样与确认交期/ }).last().click();
}

test("scenario conversation completes, keeps hint rules after reload, and never changes SRS", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await openScenarios(page);
  const before = await (await page.request.get("/api/repository")).json();
  await page.getByRole("button", { name: /展开参考表达/ }).click();
  await page.getByRole("button", { name: "不录音，直接说" }).click();
  await expect(page.getByRole("button", { name: "能独立说清楚" })).toBeDisabled();
  await expect(page.getByText("进度已同步", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /场景口语/ }).click();
  await expect(page.getByText("正在读取练习进度…")).toHaveCount(0);
  await page.getByRole("button", { name: /寄样与确认交期.*第 1/ }).click();
  await expect(page.getByRole("button", { name: "能独立说清楚" })).toBeDisabled();
  await page.getByRole("button", { name: "能说一些，还会卡" }).click();
  await page.getByRole("button", { name: "下一轮对话" }).click();
  await expect(page.getByText("When can you send the samples?")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  for (let turn = 1; turn < 3; turn += 1) {
    await page.getByRole("button", { name: "不录音，直接说" }).click();
    await page.getByRole("button", { name: "能独立说清楚" }).click();
    await page.getByRole("button", { name: turn === 2 ? "完成这段对话" : "下一轮对话" }).click();
  }
  await expect(page.getByText("这段对话，练完了")).toBeVisible();
  await expect(page.getByText("进度已同步", { exact: true })).toBeVisible();
  await page.waitForTimeout(1200);
  await expect(page.getByText("这段对话，练完了")).toBeVisible();
  expect((await (await page.request.get("/api/repository")).json()).snapshot).toEqual(before.snapshot);
  expect(errors).toEqual([]);
});

test("recording upload, transcript confirmation, feedback, retry and explicit review form a complete loop", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  // Deterministic recorder output, not a real microphone test. Windows WebKit lacks Web Audio;
  // it must expose the manual fallback, while Chromium exercises actual WAV decoding.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } });
    class FixtureRecorder {
      state = "inactive"; mimeType = "audio/wav"; ondataavailable?: (e: { data: Blob }) => void; onstop?: () => void;
      start() { this.state = "recording"; }
      stop() {
        this.state = "inactive";
        const bytes = new Uint8Array(32044); const view = new DataView(bytes.buffer);
        const label = (at: number, text: string) => { for (let i = 0; i < text.length; i++) bytes[at + i] = text.charCodeAt(i); };
        label(0, "RIFF"); view.setUint32(4, 32036, true); label(8, "WAVEfmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); label(36, "data"); view.setUint32(40, 32000, true);
        queueMicrotask(() => { this.ondataavailable?.({ data: new Blob([bytes], { type: this.mimeType }) }); this.onstop?.(); });
      }
    }
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: FixtureRecorder });
  });
  let uploads = 0; const feedbackInputs: Array<{ transcript: string; previousTranscript?: string }> = [];
  await page.route("**/api/scenarios/transcribe", async (route) => {
    uploads += 1; expect(route.request().postDataBuffer()?.subarray(0, 4).toString()).toBe("RIFF");
    await route.fulfill({ json: { transcript: "Sure, which models you need?" } });
  });
  const response = { ...feedbackFixture, improvedAnswer: "Of course. Which model would you like, and how many samples do you need?", translation: "当然。你想要哪个型号，需要几个样品？" };
  await page.route("**/api/scenarios/feedback", async (route) => {
    feedbackInputs.push(route.request().postDataJSON());
    await route.fulfill({ json: { feedback: { ...response, ...(feedbackInputs.length > 1 ? { comparison: "这次补上了样品数量。" } : {}) } } });
  });
  await openScenarios(page);
  const before = (await (await page.request.get("/api/repository")).json()).snapshot;
  await page.getByRole("button", { name: "录下我的回答" }).click(); await page.getByRole("button", { name: "停止录音" }).click();
  await expect(page.getByRole("button", { name: "上传录音并转写" })).toBeVisible(); expect(uploads).toBe(0); expect(feedbackInputs).toHaveLength(0);
  const canDecodeAudio = await page.evaluate(() => typeof OfflineAudioContext !== "undefined");
  await page.getByRole("button", { name: "上传录音并转写" }).click();
  if (canDecodeAudio) { await expect(page.getByRole("textbox", { name: "我刚才的回答" })).toHaveValue("Sure, which models you need?"); expect(uploads).toBe(1); }
  else { await expect(page.getByRole("alert")).toContainText("当前浏览器无法转换录音，请手动填写回答"); expect(uploads).toBe(0); }
  expect(feedbackInputs).toHaveLength(0);
  await page.getByRole("textbox", { name: "我刚才的回答" }).fill("Sure. Which model do you need?"); await page.getByRole("button", { name: "确认文字，获取建议" }).click();
  await expect(page.getByText(response.summary)).toBeVisible(); expect(feedbackInputs[0].transcript).toBe("Sure. Which model do you need?"); await expect(page.getByRole("button", { name: "能独立说清楚" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "加入我的复习" })).toBeDisabled();
  await page.getByRole("checkbox", { name: "我已理解并开口练过这句" }).check(); await page.getByRole("button", { name: "加入我的复习" }).click(); await expect(page.getByRole("button", { name: "已加入待复习" })).toBeVisible();
  const after = (await (await page.request.get("/api/repository")).json()).snapshot;
  expect(after.phrases.some((p: { english: string }) => p.english === response.improvedAnswer)).toBe(true); expect(after.trainingEvents).toEqual(before.trainingEvents);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.getByRole("button", { name: "按建议再说一次" }).click(); await page.getByRole("button", { name: "不录音，直接说" }).click();
  await expect(page.getByRole("button", { name: "能独立说清楚" })).toBeEnabled(); await expect(page.getByRole("textbox", { name: "我刚才的回答" })).toHaveValue("");
  await page.getByRole("textbox", { name: "我刚才的回答" }).fill(response.improvedAnswer); await page.getByRole("button", { name: "确认文字，获取建议" }).click(); await expect(page.getByText("这次补上了样品数量。", { exact: false })).toBeVisible();
  expect(feedbackInputs[1].previousTranscript).toBe("Sure. Which model do you need?");
  await page.getByRole("button", { name: "能说一些，还会卡" }).click(); await page.getByRole("button", { name: "下一轮对话" }).click();
  for (let turn = 1; turn < 3; turn++) {
    await page.getByRole("button", { name: "不录音，直接说" }).click(); await page.getByRole("button", { name: "能独立说清楚" }).click(); await page.getByRole("button", { name: turn === 2 ? "完成这段对话" : "下一轮对话" }).click();
  }
  await expect(page.getByText("这段对话，练完了")).toBeVisible(); await expect(page.getByText("进度已同步", { exact: true })).toBeVisible(); expect(errors).toEqual([]);
  await page.getByRole("button", { name: "换个场景" }).click(); await expect(page.getByText(/可复用.*条已学表达/).first()).toBeVisible();
});
