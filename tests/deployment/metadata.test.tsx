import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MetadataHead, ViewportHead, mergeViewport } from "vinext/shims/metadata";

const layoutSource = readFileSync(resolve(process.cwd(), "app", "layout.tsx"), "utf8");
const viewport = {
  width: "device-width, viewport-fit=cover",
  initialScale: 1,
  themeColor: "#0b4a3a",
};

describe("production metadata rendering", () => {
  it("renders one complete viewport tag", () => {
    const html = renderToStaticMarkup(<ViewportHead viewport={mergeViewport([viewport])} />);
    const tags = html.match(/<meta[^>]+name="viewport"[^>]*>/g) ?? [];

    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain("width=device-width");
    expect(tags[0]).toContain("initial-scale=1");
    expect(tags[0]).toContain("viewport-fit=cover");
    expect(tags[0].match(/initial-scale=1/g)).toHaveLength(1);
    expect(layoutSource).toContain('width: "device-width, viewport-fit=cover"');
    expect(layoutSource).toContain("initialScale: 1");
    expect(layoutSource).not.toContain('<meta name="viewport"');
  });

  it("renders the Apple home-screen capability metadata", () => {
    const html = renderToStaticMarkup(<MetadataHead metadata={{
      appleWebApp: { capable: true },
      other: { "apple-mobile-web-app-capable": "yes" },
    }} />);

    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes"/>');
    expect(layoutSource).toContain('"apple-mobile-web-app-capable": "yes"');
  });
});
