import type { Metadata, Viewport } from "next";
import { Geist, Noto_Sans_SC } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-latin", subsets: ["latin"] });
const noto = Noto_Sans_SC({ variable: "--font-cjk", subsets: ["latin"], weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
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

export const viewport: Viewport = {
  width: "device-width, viewport-fit=cover",
  initialScale: 1,
  themeColor: "#0b4a3a",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body className={`${geist.variable} ${noto.variable}`}>{children}</body></html>;
}
