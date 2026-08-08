import { Geist, Noto_Sans_SC } from "next/font/google";
import "./globals.css";

export { appMetadata as metadata, appViewport as viewport } from "./metadataConfig";

const geist = Geist({ variable: "--font-latin", subsets: ["latin"] });
const noto = Noto_Sans_SC({ variable: "--font-cjk", subsets: ["latin"], weight: ["400", "500", "600", "700"] });

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body className={`${geist.variable} ${noto.variable}`}>{children}</body></html>;
}
