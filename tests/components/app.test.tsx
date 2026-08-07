import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PhraseBankApp } from "../../app/PhraseBankApp";
import type { BackupEnvelope, Category, Phrase, ReviewResult } from "../../app/domain/types";

class MemoryRepository {
  phrases: Phrase[] = [];
  categories: Category[] = [{ id: "daily", name: "日常", isDefault: true, createdAt: "2026-08-07T00:00:00.000Z", updatedAt: "2026-08-07T00:00:00.000Z" }];
  async initialize() {}
  async listPhrases() { return [...this.phrases]; }
  async listCategories() { return [...this.categories]; }
  async listDuePhrases() { return [...this.phrases]; }
  async savePhrase(phrase: Phrase) { this.phrases = [...this.phrases.filter((p) => p.id !== phrase.id), phrase]; }
  async deletePhrase(id: string) { this.phrases = this.phrases.filter((p) => p.id !== id); }
  async submitReview(_id: string, _result: ReviewResult) {}
  async saveCategory(category: Category) { this.categories.push(category); }
  async deleteCategoryAndMigrate() {}
  async exportSnapshot(): Promise<BackupEnvelope> { return { format: "personal-phrase-bank", version: 1, exportedAt: new Date().toISOString(), categories: this.categories, phrases: this.phrases, reviewLogs: [] }; }
  async importSnapshot() {}
}

describe("PhraseBankApp", () => {
  it("validates and saves a new phrase", async () => {
    const user = userEvent.setup();
    const repo = new MemoryRepository();
    render(<PhraseBankApp repository={repo as never} />);
    await screen.findByText(/收藏新的表达/);
    await user.click(screen.getByRole("button", { name: "添加" }));
    await user.click(screen.getByRole("button", { name: "保存语言块" }));
    expect(screen.getByText("请输入英文表达")).toBeInTheDocument();
    await user.type(screen.getByLabelText("英文表达"), "I haven't decided yet.");
    await user.type(screen.getByLabelText("中文含义"), "我还没决定。");
    await user.click(screen.getByRole("button", { name: "保存语言块" }));
    expect(await screen.findByText("I haven't decided yet.")).toBeInTheDocument();
  });

  it("shows Chinese first and reveals English during review", async () => {
    const user = userEvent.setup();
    const repo = new MemoryRepository();
    repo.phrases.push({ id: "p1", english: "I'll get back to you.", chinese: "我会回复你的。", categoryId: "daily", reviewStep: 0, masteryLevel: 0, nextReviewAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    render(<PhraseBankApp repository={repo as never} />);
    await user.click(await screen.findByText(/开始今日复习/));
    expect(screen.getByText("我会回复你的。")).toBeInTheDocument();
    expect(screen.queryByText("I'll get back to you.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "显示英文答案" }));
    expect(screen.getByText("I'll get back to you.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /掌握/ })).toBeInTheDocument();
  });
});
