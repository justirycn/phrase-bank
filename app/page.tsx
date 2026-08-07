import type { Metadata } from "next";
import { PhraseBankApp } from "./PhraseBankApp";

export const metadata: Metadata = {
  title: "Phrase Bank · 我的英语语言块",
  description: "收藏真正会用到的英语表达，用中文提示练习主动调用。",
};

export default function Home() {
  return <PhraseBankApp />;
}
