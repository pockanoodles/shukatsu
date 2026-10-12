import Link from "next/link";
import { getLang, getUser } from "@/lib/server/session";
import { translator } from "@/lib/i18n";
import { Bare } from "@/components/bare";
import { Claim } from "@/components/claim";
import { Stamp } from "@/components/marks";

// The landing page is public, so its record is an example candidate, never
// the real one. Every figure below is labeled as an example.
const EXAMPLE = [
  { id: "acme.routing", prov: "U", text: "Rebuilt lead routing for a 6-person team, cutting manual triage from 40 to 5 minutes a day across 1,200 weekly leads.", state: "confirmed" },
  { id: "tool.speed", prov: "V", text: "Built an open-source CLI that cuts a 45 minute report build to 13 seconds with a two-layer cache, used by 30 people.", state: "confirmed" },
  { id: "acme.dashboard", prov: "M", text: "Built a pipeline dashboard tracking 14 KPIs that the ops lead reviewed every Monday with 3 regional managers.", state: "waiting" },
];

const DIGEST_JA = `就活レポート 10/5〜10/12

応募：2件
  Example Co · Operations Intern
  Sample Labs · Data Analyst Co-op

進捗
  Demo Inc · BizOps Intern: 応募済み → 面接

進行中：9件中4件
本人の確認待ち：1件
確認キュー：6件（うち提案2件）
評価待ちの求人：12件`;

export default async function Landing() {
  const lang = await getLang();
  const user = await getUser();
  const { t, list } = translator(lang);
  const rules = list<string[][]>("landing.rules");
  const roles = list<string[][]>("landing.roles");
  const points = list<string[][]>("landing.homePoints");
  const cta = user ? <Link href="/today" className="btn">{t("landing.open")}</Link> : <Link href="/login" className="btn">{t("landing.signIn")}</Link>;
  return (
    <Bare lang={lang} back="/" right={<div className="hidden items-center gap-6 pr-4 md:flex">
      <a href="#rules" className="label text-ink-2 hover:text-ink">{t("landing.rulesEyebrow")}</a>
      <a href="#family" className="label text-ink-2 hover:text-ink">{t("landing.familyEyebrow")}</a>
      <a href="#home" className="label text-ink-2 hover:text-ink">{t("landing.homeEyebrow")}</a>
      {user ? <Link href="/today" className="btn btn-ghost btn-sm">{t("landing.open")}</Link> : <Link href="/login" className="btn btn-ghost btn-sm">{t("landing.signIn")}</Link>}
    </div>}>
      <main>
        <section className="grid border-b-2 rule lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="flex flex-col justify-between gap-6 border-b-2 rule px-4 pt-6 sm:px-10 lg:border-b-0 lg:border-r-2 lg:pt-8">
            <span className="label text-ink-2">Job hunting · 就職活動</span>
            <span className="kanji rise -ml-1 text-[clamp(140px,19vw,290px)]" aria-hidden>就活</span>
            <span className="label flex justify-between border-t hair py-3 text-ink-2"><span>v0.1</span><span>{t("landing.ledgerFoot")}</span></span>
          </div>
          <div className="grid content-start gap-7 px-4 py-10 sm:px-10 lg:py-14">
            <span className="label text-ink-2">{t("landing.eyebrow")}</span>
            {/* Japanese breaks at the phrase, never mid-word; English runs on one line. */}
            <h1 className={`display rise [line-break:strict] ${lang === "ja" ? "text-[clamp(32px,8.6vw,104px)]" : "text-[clamp(56px,8.6vw,132px)]"}`}>
              {lang === "ja" ? <><span className="block">{t("landing.h1a")}</span><span className="block text-shu">{t("landing.h1b")}</span></>
                : <>{t("landing.h1a")} <span className="text-shu">{t("landing.h1b")}</span></>}
            </h1>
            <p className="max-w-[38rem] text-[17px] text-ink-2">{t("landing.lede")}</p>
            <p lang={lang === "ja" ? "en" : "ja"} className="max-w-[38rem] border-l-[3px] border-shu pl-3 text-[14.5px] text-ink-2">{t("landing.ja")}</p>
            <div className="flex flex-wrap gap-3">{cta}<a href="#home" className="btn btn-ghost">{t("landing.selfHost")}</a></div>
          </div>
        </section>

        <figure className="m-0 border-b-2 rule" aria-label={t("landing.ledgerCaption")}>
          <figcaption className="label flex justify-between border-b-2 rule px-4 py-2.5 text-ink-2 sm:px-10"><span>{t("landing.ledgerCaption")}</span><span>Example</span></figcaption>
          <div className="label hidden grid-cols-[56px_240px_44px_minmax(0,1fr)_120px] border-b hair px-10 py-2 text-ink-3 md:grid">
            <span>{t("landing.cols.n")}</span><span>{t("landing.cols.fact")}</span><span>{t("landing.cols.src")}</span><span>{t("landing.cols.line")}</span><span className="text-right">{t("landing.cols.state")}</span>
          </div>
          <ol>
            {EXAMPLE.map((r, i) => (
              <li key={r.id} className="grid grid-cols-[28px_minmax(0,1fr)_64px] items-baseline gap-x-4 gap-y-2 border-b hair px-4 py-4 last:border-b-0 sm:px-10 md:grid-cols-[56px_240px_44px_minmax(0,1fr)_120px] md:gap-y-0">
                <span className="code text-ink-3">0{i + 1}</span>
                <span className="code">{r.id}</span>
                <span className="prov hidden md:inline-grid">{r.prov}</span>
                <span className="col-span-3 text-[15px] md:col-span-1 md:pr-6"><Claim text={r.text} /></span>
                <span className="col-start-3 row-start-1 justify-self-end md:col-start-auto md:row-start-auto">
                  {r.state === "waiting" ? <Stamp two>確認<br />待ち</Stamp> : <span className="label">{t("status.confirmed")}</span>}
                </span>
              </li>
            ))}
          </ol>
        </figure>

        <section id="rules" className="scroll-mt-14 border-b-2 rule">
          <div className="grid gap-4 px-4 py-14 sm:px-10 lg:grid-cols-2 lg:items-end lg:gap-16 lg:py-20">
            <div><p className="label text-ink-2">{t("landing.rulesEyebrow")}</p><h2 className="display mt-3 text-[clamp(34px,4.6vw,60px)]">{t("landing.rulesTitle")}</h2></div>
            <p className="max-w-xl text-[16px] text-ink-2">{t("landing.rulesLead")}</p>
          </div>
          <ol className="grid border-t-2 rule md:grid-cols-2 xl:grid-cols-4">
            {rules.map(([title, body], i) => (
              <li key={title} className={`grid content-start gap-3 border-b-2 rule px-4 py-8 sm:px-10 xl:border-b-0 xl:px-8 ${i % 2 === 0 ? "md:border-r-2" : ""} ${i < 3 ? "xl:border-r-2" : "xl:border-r-0"}`}>
                <span className="code text-ink-3">0{i + 1}</span>
                <h3 className="heading text-[24px]">{title}</h3>
                <p className="text-[15px] text-ink-2">{body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="family" className="scroll-mt-14 grid border-b-2 rule lg:grid-cols-2">
          <div className="grid content-start gap-6 border-b-2 rule px-4 py-14 sm:px-10 lg:border-b-0 lg:border-r-2 lg:py-20">
            <p className="label text-ink-2">{t("landing.familyEyebrow")}</p>
            <h2 className="display text-[clamp(34px,4.6vw,60px)]">{t("landing.familyTitle")}</h2>
            <p className="max-w-xl text-[16px] text-ink-2">{t("landing.familyLead")}</p>
            <ul className="border-t-2 rule">
              {roles.map(([r, d]) => <li key={r} className="grid gap-1 border-b hair py-4 sm:grid-cols-[140px_minmax(0,1fr)]"><span className="heading text-[17px]">{r}</span><span className="text-ink-2">{d}</span></li>)}
            </ul>
          </div>
          <figure className="m-0 grid content-start gap-4 px-4 py-14 sm:px-10 lg:py-20">
            <figcaption className="label flex justify-between text-ink-2"><span>{t("landing.digestCaption")}</span><span>Example</span></figcaption>
            <pre lang="ja" className="code whitespace-pre-wrap border-2 rule bg-paper-2 p-5 text-[13.5px] leading-[1.8]">{DIGEST_JA}</pre>
            <div className="flex items-center gap-5 pt-2"><Stamp size="lg">本人<br />確認</Stamp><p className="max-w-xs text-[14px] text-ink-2">{t("review.out.acceptLead")}</p></div>
          </figure>
        </section>

        <section id="home" className="scroll-mt-14 border-b-2 rule">
          <div className="grid gap-6 px-4 py-14 sm:px-10 lg:grid-cols-2 lg:gap-16 lg:py-20">
            <div><p className="label text-ink-2">{t("landing.homeEyebrow")}</p><h2 className="display mt-3 text-[clamp(34px,4.6vw,60px)]">{t("landing.homeTitle")}</h2></div>
            <p className="max-w-xl self-end text-[16px] text-ink-2">{t("landing.homeLead")}</p>
          </div>
          <ul className="grid border-t-2 rule md:grid-cols-3">
            {points.map(([h, d], i) => <li key={h} className={`grid content-start gap-2 border-b-2 rule px-4 py-8 sm:px-10 md:border-b-0 md:px-8 ${i < 2 ? "md:border-r-2" : ""}`}><h3 className="heading text-[20px]">{h}</h3><p className="text-[15px] text-ink-2">{d}</p></li>)}
          </ul>
        </section>

        <footer className="grid gap-4 px-4 py-10 sm:px-10 md:grid-cols-[240px_minmax(0,1fr)]">
          <span className="label text-ink-2">shukatsu · 2026</span>
          <p className="max-w-3xl text-[13.5px] text-ink-2">{t("landing.footer")}</p>
        </footer>
      </main>
    </Bare>
  );
}
