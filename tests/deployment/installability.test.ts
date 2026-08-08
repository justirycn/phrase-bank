import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const publicPath = (...parts: string[]) => resolve(process.cwd(), "public", ...parts);

function pngSize(path: string) {
  const png = readFileSync(path);
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

describe("installability", () => {
  it("declares the installable app identity and icons", () => {
    const manifest = JSON.parse(readFileSync(publicPath("manifest.webmanifest"), "utf8"));

    expect(manifest.name).toBe("Phrase Bank · 我的英语语言块");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: "/icons/icon-192.png", sizes: "192x192" }),
      expect.objectContaining({ src: "/icons/icon-512.png", sizes: "512x512" }),
      expect.objectContaining({ src: "/icons/icon-maskable-512.png", purpose: "maskable" }),
    ]));
  });

  it("provides a correctly sized Apple touch icon", () => {
    expect(pngSize(publicPath("icons", "apple-touch-icon.png"))).toEqual({
      width: 180,
      height: 180,
    });
  });
});
