import { describe, expect, it } from "vitest";
import { validateCategoryName, validatePhraseInput } from "../../app/domain/validation";

describe("phrase validation", () => {
  it("requires trimmed English, Chinese and category values", () => {
    expect(validatePhraseInput({ english: " ", chinese: "", categoryId: "" })).toEqual({
      english: "请输入英文表达",
      chinese: "请输入中文含义",
      categoryId: "请选择分类",
    });
  });

  it("accepts a complete phrase", () => {
    expect(validatePhraseInput({ english: " I'm ready. ", chinese: " 我准备好了。 ", categoryId: "daily" })).toEqual({});
  });
});

describe("category validation", () => {
  it("rejects duplicate names regardless of whitespace or case", () => {
    expect(validateCategoryName("  DAILY ", ["Daily"])).toBe("分类名称已存在");
  });
});
