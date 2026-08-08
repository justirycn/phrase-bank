import type { Metadata, Viewport } from "next";

// vinext beta.2 drops viewportFit but serializes width verbatim, so keep the
// initial-parse iPhone safe-area directive in this isolated compatibility value.
const VINEXT_VIEWPORT_WIDTH_WORKAROUND = "device-width, viewport-fit=cover";

export const appMetadata: Metadata = {
  title: "Phrase Bank · 我的英语语言块",
  description: "收藏、复习并主动调用真正会用到的英语表达。",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Phrase Bank",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
};

export const appViewport: Viewport = {
  width: VINEXT_VIEWPORT_WIDTH_WORKAROUND,
  initialScale: 1,
  themeColor: "#0b4a3a",
};
