import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MetadataHead, ViewportHead, mergeViewport } from "vinext/shims/metadata";
import { appMetadata, appViewport } from "../../app/metadataConfig";

describe("production metadata rendering", () => {
  it("renders one complete viewport tag", () => {
    const html = renderToStaticMarkup(<ViewportHead viewport={mergeViewport([appViewport])} />);
    const tags = html.match(/<meta[^>]+name="viewport"[^>]*>/g) ?? [];

    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain("width=device-width");
    expect(tags[0]).toContain("initial-scale=1");
    expect(tags[0]).toContain("viewport-fit=cover");
    expect(tags[0].match(/width=device-width/g)).toHaveLength(1);
    expect(tags[0].match(/initial-scale=1/g)).toHaveLength(1);
    expect(tags[0].match(/viewport-fit=cover/g)).toHaveLength(1);
  });

  it("renders the Apple home-screen capability metadata", () => {
    const html = renderToStaticMarkup(<MetadataHead metadata={appMetadata} />);

    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes"/>');
  });
});
