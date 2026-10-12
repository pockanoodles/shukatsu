import Link from "next/link";
import type { Metadata } from "next";
import { engine } from "@/lib/server/engine";
import { allowed, requireCan } from "@/lib/server/session";
import { translator, type T } from "@/lib/i18n";
import { Claim } from "@/components/claim";
import { Head, Prov, Stamp, StatusMark } from "@/components/marks";
import { FactActions, JaHeaderForm, NewFact, NewRole } from "./forms";

export const metadata: Metadata = { title: "Record" };

type Fact = { id: string; text: string; tags?: string[]; provenance?: string; priority?: number; pin?: boolean; status?: string; review_status?: string; variants?: { key: string; text: string; for?: string[]; review_status?: string; status?: string }[]; ja?: { text: string; review_status?: string; status?: string } };
type Entity = { id: string; label: string; heading: string; title?: string; dates?: string; section: string; ended?: boolean; status?: string; review_status?: string; facts?: Fact[] };

const SECTIONS = ["work", "projects", "volunteering", "education"];

function stateOf(x: { status?: string; review_status?: string }) {
  const s = x.status ?? "active";
  return s !== "active" ? s : (x.review_status ?? "verified") === "verified" ? "confirmed" : "waiting";
}

function FactRow({ f, n, e, usedBy, openProposals, owner, canPropose, t, l }: {
  f: Fact; n: number; e: Entity; usedBy: number; openProposals: number; owner: boolean; canPropose: boolean; t: T; l: Record<string, string>;
}) {
  const st = stateOf(f);
  const aside = ["retired", "rejected", "cannot-confirm"].includes(st);
  return (
    <li id={f.id} className={`grid scroll-mt-20 gap-x-6 gap-y-2 border-b hair px-4 py-4 sm:px-10 md:grid-cols-[44px_230px_minmax(0,1fr)_120px] ${aside ? "opacity-60" : ""}`}>
      <span className="code hidden pt-1 text-ink-3 md:block">{String(n).padStart(2, "0")}</span>
      <span className="flex items-start gap-2 md:pt-0.5">
        <Prov letter={f.provenance ?? null} t={t} />
        <span className="code break-all pt-0.5">{f.id}</span>
      </span>
      <div className="grid min-w-0 gap-2">
        <p className={`text-[15.5px] leading-[1.55] ${st === "retired" || st === "rejected" ? "line-through decoration-ink-3" : ""}`}><Claim text={f.text} /></p>
        {f.ja?.text && <p lang="ja" className="text-[14px] text-ink-2">{f.ja.text} <StatusMark status={f.ja.status ?? "active"} review={f.ja.review_status ?? "verified"} t={t} /></p>}
        {f.variants?.length ? (
          <details className="text-[14px]"><summary className="label cursor-pointer text-ink-3">{t("record.variants")} · {f.variants.length}</summary>
            <ul className="mt-2 grid gap-2 border-l-2 border-hair pl-3">{f.variants.map((v) => (
              <li key={v.key} className="text-ink-2"><span className="code mr-2 text-ink-3">{v.key} → {(v.for || []).join(", ")}</span>{v.text} <StatusMark status={v.status ?? "active"} review={v.review_status ?? "verified"} t={t} /></li>
            ))}</ul>
          </details>
        ) : null}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-3">
          {(f.tags || []).length ? <span className="code">{(f.tags || []).join(" · ")}</span> : null}
          {f.pin && <span className="label">{t("record.pinned")}</span>}
          <span className="label">{usedBy === 1 ? t("record.usedOne") : usedBy ? t("record.used", { n: usedBy }) : t("record.usedNone")}</span>
          {openProposals ? <Link href="/review" className="label text-shu">{openProposals} → {t("nav.review")}</Link> : null}
        </div>
        {canPropose && st !== "retired" && st !== "rejected" && <FactActions id={f.id} text={f.text} ja={f.ja?.text ?? null} current={e.ended === false} owner={owner} l={l} />}
      </div>
      <span className="md:justify-self-end md:pt-0.5">
        {st === "waiting" ? <Link href={`/review?item=${encodeURIComponent(`draft:fact:${f.id}`)}`}><Stamp two>確認<br />待ち</Stamp></Link>
          : <StatusMark status={f.status ?? "active"} review={f.review_status ?? "verified"} t={t} />}
      </span>
    </li>
  );
}

export default async function RecordPage() {
  const user = await requireCan("view.profile");
  const { t } = translator(user.lang);
  const { root, facts, manifests, proposals, candidate } = await engine();
  const p = facts.loadProfile(root);
  const owner = user.role === "owner";
  const canPropose = allowed(user, "propose.profile");
  const sent = new Map<string, number>();
  for (const m of manifests.readManifests(root)) for (const id of new Set<string>(manifests.sentIds(m))) sent.set(id, (sent.get(id) || 0) + 1);
  const open = new Map<string, number>();
  for (const pr of proposals.openProposals(root)) if (pr.target) open.set(pr.target, (open.get(pr.target) || 0) + 1);
  const all: Fact[] = [...p._facts.values()].map((x: { fact: Fact }) => x.fact);
  const live = all.filter((f) => stateOf(f) === "confirmed").length;
  const pending = all.filter((f) => stateOf(f) === "waiting").length;
  const l: Record<string, string> = {
    suggestEdit: t("record.suggestEdit"), editDirect: t("record.editDirect"), retire: t("record.retire"), ja: t("record.ja"),
    suggestNew: t("record.suggestNew"), addDirect: t("record.addDirect"), suggestRole: t("record.suggestRole"), addRole: t("record.addRole"),
    proposeHelp: t("record.proposeHelp"), directHelp: t("record.directHelp"), submitPropose: t("record.submitPropose"), submitDirect: t("record.submitDirect"),
    newText: t("record.newText"), newTextHelp: t("record.newTextHelp"), newJa: t("record.newJa"), reasonRetire: t("record.reasonRetire"),
    tags: t("record.tags"), priority: t("record.priority"), note: t("review.note"), optional: t("common.optional"),
    chars: t("common.chars"), pass: t("review.rules.pass"), figures: t("record.figuresChanged"), working: t("common.loading"),
    roleSection: t("record.roleSection"), roleLabel: t("record.roleLabel"), roleHeading: t("record.roleHeading"), roleTitle: t("record.roleTitle"),
    roleDates: t("record.roleDates"), roleEnded: t("record.roleEnded"),
    sec_work: t("record.sections.work"), sec_projects: t("record.sections.projects"), sec_volunteering: t("record.sections.volunteering"), sec_education: t("record.sections.education"),
  };
  let n = 0;
  return (
    <div>
      <Head eyebrow={t("record.counts", { live, pending, aside: all.length - live - pending })} title={t("record.title")} lead={owner ? t("record.lead") : t("record.leadHelper")}>
        {canPropose && <div className="w-full sm:w-auto"><NewRole owner={owner} l={l} /></div>}
      </Head>
      <nav className="scroll-thin flex gap-0 overflow-x-auto border-b-2 rule" aria-label={t("record.title")}>
        {SECTIONS.filter((s) => p._entities.some((e: Entity) => e.section === s)).map((s) => (
          <a key={s} href={`#sec-${s}`} className="label border-r-2 rule px-4 py-3 hover:bg-paper-3 sm:px-6">{t(`section.${s}`)}</a>
        ))}
        <a href="#sec-skills" className="label border-r-2 rule px-4 py-3 hover:bg-paper-3 sm:px-6">{t("section.skills")}</a>
      </nav>
      {SECTIONS.map((s) => {
        const ents: Entity[] = p._entities.filter((e: Entity) => e.section === s);
        if (!ents.length) return null;
        return (
          <section key={s} id={`sec-${s}`} className="scroll-mt-16">
            <h2 className="label sticky top-14 z-10 border-b-2 rule bg-paper-2 px-4 py-2.5 text-ink-2 sm:px-10">{t(`section.${s}`)}</h2>
            {ents.map((e) => {
              const st = stateOf(e);
              return (
                <div key={e.id} id={e.id} className="scroll-mt-28 border-b-2 rule">
                  <div className="flex flex-wrap items-start justify-between gap-4 px-4 pb-3 pt-6 sm:px-10">
                    <div className="grid gap-1">
                      <h3 className="heading text-[22px] sm:text-[26px]">{e.heading}</h3>
                      <p className="text-ink-2">{[e.title, e.dates].filter(Boolean).join(" · ")}</p>
                    </div>
                    {st === "waiting" ? <Link href={`/review?item=${encodeURIComponent(`draft:entity:${e.id}`)}`}><Stamp two>確認<br />待ち</Stamp></Link> : st !== "confirmed" ? <StatusMark status={e.status ?? "active"} review={e.review_status ?? "verified"} t={t} /> : null}
                  </div>
                  <ol>
                    {(e.facts || []).map((f) => <FactRow key={f.id} f={f} n={++n} e={e} usedBy={sent.get(f.id) || 0} openProposals={open.get(f.id) || 0} owner={owner} canPropose={canPropose} t={t} l={l} />)}
                    {!(e.facts || []).length && <li className="px-4 py-4 text-ink-3 sm:px-10">{t("record.noFacts")}</li>}
                  </ol>
                  {canPropose && st !== "rejected" && <div className="px-4 py-4 sm:px-10"><NewFact entity={e.id} tags={p.tag_vocabulary || []} current={e.ended === false} owner={owner} l={l} /></div>}
                </div>
              );
            })}
          </section>
        );
      })}
      <section id="sec-skills" className="scroll-mt-16">
        <h2 className="label border-b-2 rule bg-paper-2 px-4 py-2.5 text-ink-2 sm:px-10">{t("section.certifications")} · {t("section.skills")}</h2>
        <ul>
          {[...(p.certifications || []), ...(p.skills || [])].map((f: Fact & { group?: string }) => (
            <li key={f.id} className="grid gap-x-6 gap-y-1 border-b hair px-4 py-3 sm:px-10 md:grid-cols-[274px_minmax(0,1fr)]">
              <span className="code text-ink-2">{f.group || f.id}</span>
              <span>{f.text.replace(/\*\*/g, "")}</span>
            </li>
          ))}
        </ul>
      </section>
      {owner && (() => {
        const c = candidate.candidateJa(root);
        return (
          <section id="ja-header" className="scroll-mt-16 border-t-2 rule">
            <h2 className="label border-b-2 rule bg-paper-2 px-4 py-2.5 text-ink-2 sm:px-10">{t("record.jaHeader")}</h2>
            <div className="grid max-w-4xl gap-4 px-4 py-6 sm:px-10">
              <p className="text-[14px] text-ink-2">{t("record.jaHeaderLead")}</p>
              <JaHeaderForm values={c.ja} english={c.en} l={{ jaName: t("record.jaName"), jaLocation: t("record.jaLocation"), jaAvailability: t("record.jaAvailability"), jaSave: t("record.jaSave"), working: t("common.loading") }} />
            </div>
          </section>
        );
      })()}
    </div>
  );
}
