import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const auditRoot = `${process.cwd()}/docs/audits/home-heatmap-performance`;

function jpegDimensions(name: string) {
  const bytes = readFileSync(`${auditRoot}/${name}`);
  expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) throw new Error(`${name} has an invalid JPEG marker`);
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
    }
    offset += 2 + length;
  }
  throw new Error(`${name} has no JPEG size marker`);
}

describe("home performance audit evidence", () => {
  it("keeps unmodified browser JPEG evidence with disclosed export sizes", () => {
    expect(jpegDimensions("01-home-390x844-full.jpg")).toEqual({ width: 375, height: 1608 });
    expect(jpegDimensions("02-library-fallback-390x844.jpg")).toEqual({ width: 390, height: 844 });
    expect(jpegDimensions("03-library-loaded-390x844.jpg")).toEqual({ width: 375, height: 812 });
    expect(jpegDimensions("04-home-zoom-attempt-no-effect.jpg")).toEqual({ width: 375, height: 812 });
  });

  it("discloses the local viewport and non-device limitations", () => {
    const readme = readFileSync(`${auditRoot}/README.md`, "utf8");
    expect(readme).toContain("390×844 CSS viewport");
    expect(readme).toContain("not a real iPhone");
    expect(readme).toContain("not Safari");
    expect(readme).toContain("not a public-network measurement");
  });

  it("records the deterministic large-library benchmark and bounded rows", () => {
    const metrics = JSON.parse(readFileSync(`${auditRoot}/metrics.json`, "utf8"));
    expect(metrics.homeDataBenchmark.fixture).toEqual({
      seed: 20260811, phrases: 2000, categories: 10, learningStates: 2000,
      events: 10080, trainingSessions: 1440,
    });
    expect(metrics.homeDataBenchmark.calls.exportSnapshot).toBe(0);
    expect(metrics.homeDataBenchmark.rows).toEqual({ trainingEvents: 6636, trainingSessions: 948, heatmapDays: 84 });
    expect(metrics.homeDataBenchmark.regressionBudgetMilliseconds).toBe(5000);
  });
});
