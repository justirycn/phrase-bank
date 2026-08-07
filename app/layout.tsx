import type { Metadata, Viewport } from "next";
import { Geist, Noto_Sans_SC } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-latin", subsets: ["latin"] });
const noto = Noto_Sans_SC({ variable: "--font-cjk", subsets: ["latin"], weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: "Phrase Bank · 我的英语语言块",
  description: "收藏真正会用到的英语表达，用中文提示练习主动调用。",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "Phrase Bank",
    description: "让收藏变成脱口而出的表达",
    images: [{ url: "/og.png", width: 1733, height: 909, alt: "Phrase Bank 分享卡片" }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#153f35" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body className={`${geist.variable} ${noto.variable}`}>{children}</body></html>;
}
