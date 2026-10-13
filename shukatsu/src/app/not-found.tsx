import Link from "next/link";
import { getLang, getUser } from "@/lib/server/session";

export default async function NotFound() {
  const ja = (await getLang()) === "ja";
  const user = await getUser();
  return (
    <main className="grid min-h-[60dvh] place-content-center gap-5 px-4 py-16 text-center">
      <span className="kanji text-[120px] text-ink-3" aria-hidden>無</span>
      <h1 className="display text-[40px]">{ja ? "見つかりません" : "Not found"}</h1>
      <p className="mx-auto max-w-sm text-ink-2">{ja ? "このページは存在しないか、すでに削除されています。" : "That page doesn't exist, or it was removed."}</p>
      <Link href={user ? "/today" : "/"} className="btn justify-self-center">{user ? (ja ? "今日のページへ" : "Back to Today") : ja ? "トップへ" : "Back to start"}</Link>
    </main>
  );
}
