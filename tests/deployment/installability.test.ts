import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const publicPath = (...parts: string[]) => resolve(process.cwd(), "public", ...parts);

function pngSize(path: string) {
  const png = readFileSync(path);
  if (png.length < 24) {
    throw new Error(`Invalid PNG at ${path}: file is too short`);
  }
  if (!png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    throw new Error(`Invalid PNG at ${path}: signature is missing`);
  }
  if (png.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error(`Invalid PNG at ${path}: IHDR chunk is missing`);
  }
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

  it.each([
    ["icon-192.png", 192, 192],
    ["icon-512.png", 512, 512],
    ["icon-maskable-512.png", 512, 512],
    ["apple-touch-icon.png", 180, 180],
  ])("provides %s at %ix%i", (file, width, height) => {
    expect(pngSize(publicPath("icons", file))).toEqual({ width, height });
  });
});
