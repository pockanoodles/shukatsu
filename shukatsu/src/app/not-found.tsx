import Link from "next/link";
import { getLang } from "@/lib/server/session";

export default async function NotFound() {
  const ja = (await getLang()) === "ja";
  return (
    <main className="grid min-h-dvh place-content-center gap-6 px-4 text-center">
      <span className="kanji text-[140px] text-ink-3" aria-hidden>無</span>
      <h1 className="display text-[40px]">{ja ? "見つかりません" : "Not found"}</h1>
      <Link href="/" className="btn justify-self-center">{ja ? "トップへ" : "Back to start"}</Link>
    </main>
  );
}
