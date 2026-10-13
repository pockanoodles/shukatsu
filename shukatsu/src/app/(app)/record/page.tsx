import Link from "next/link";
import type { Metadata } from "next";
import { engine } from "@/lib/server/engine";
import { allowed, requireCan } from "@/lib/server/session";
import { translator, type T } from "@/lib/i18n";
import { Claim } from "@/components/claim";
import { StatusMark } from "@/components/marks";
import { FactActions, NewFact, NewRole } from "./forms";

export const metadata: Metadata = { title: "Record" };

type Fact = { id: string; text: string; tags?: string[]; group?: string; provenance?: string; priority?: number; pin?: boolean; status?: string; review_status?: string; variants?: { key: string; text: string; for?: string[]; review_status?: string; status?: string }[]; ja?: { text: string; review_status?: string; status?: string } };
type Entity = { id: string; label: string; heading: string; title?: string; dates?: string; section: string; ended?: boolean; status?: string; review_status?: string; facts?: Fact[] };

/** The sheet's tabs, in the order a resume reads. */
const ENTITY_TABS = ["work", "projects", "volunteering", "education"] as const;
const TABS = ["all", ...ENTITY_TABS, "certifications", "skills"] as const;
type Tab = (typeof TABS)[number];

function stateOf(x: { status?: string; review_status?: string }) {
  const s = x.status ?? "active";
  return s !== "active" ? s : (x.review_status ?? "verified") === "verified" ? "confirmed" : "waiting";
}

// One grid for the header and every row, so columns line up like a sheet.
const COLS = "md:grid-cols-[3rem_14rem_minmax(0,1fr)_9rem_4.5rem_7.5rem]";

function Status({ x, reviewKey, open, t }: { x: Fact | Entity; reviewKey: string; open: number; t: T }) {
  if (stateOf(x) === "waiting") return <Link href={`/review?item=${encodeURIComponent(reviewKey)}`} className="label text-shu hover:underline">{t("status.waiting")} →</Link>;
  return (
    <span className="grid justify-items-start gap-0.5">
      <StatusMark status={x.status ?? "active"} review={x.review_status ?? "verified"} t={t} />
      {open ? <Link href="/review" className="label text-shu hover:underline">{t("sys.sheet.proposed", { n: open })}</Link> : null}
    </span>
  );
}

/** One fact as one sheet row; pressing it opens its Japanese, variants, and actions underneath. */
function FactRow({ f, n, e, usedBy, open, owner, canPropose, t, l }: {
  f: Fact; n: number; e: Entity | null; usedBy: number; open: number; owner: boolean; canPropose: boolean; t: T; l: Record<string, string>;
}) {
  const st = stateOf(f);
  const aside = ["retired", "rejected", "cannot-confirm"].includes(st);
  const struck = st === "retired" || st === "rejected";
  const editable = canPropose && !struck && e;
  const more = Boolean(f.ja?.text || f.variants?.length || editable);
  const cells = (
    <>
      <span className="code hidden text-ink-3 md:block">{String(n).padStart(2, "0")}</span>
      <span className="code col-span-3 min-w-0 truncate text-[12.5px] text-ink-3 md:col-span-1" title={f.id}>{f.group || f.id}</span>
      <span className={`col-span-3 min-w-0 text-[14.5px] leading-[1.5] md:col-span-1 ${struck ? "line-through decoration-ink-3" : ""}`}>
        <Claim text={f.text.replace(/\*\*/g, "")} />
        {f.ja?.text && <span lang="ja" className="mt-0.5 block truncate text-[13px] text-ink-3">{f.ja.text}</span>}
      </span>
      <span className="code min-w-0 truncate text-[12.5px] text-ink-3">{(f.tags || []).join(" · ")}</span>
      <span className="label num text-ink-3 md:text-right">{usedBy || "–"}</span>
      <Status x={f} reviewKey={`draft:fact:${f.id}`} open={open} t={t} />
    </>
  );
  const row = `grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-4 gap-y-1 px-4 py-2 sm:px-6 ${COLS}`;
  if (!more) return <li id={f.id} className={`border-b hair ${aside ? "opacity-55" : ""}`}><div className={row}>{cells}</div></li>;
  return (
    <li id={f.id} className={`border-b hair ${aside ? "opacity-55" : ""}`}>
      <details className="group">
        <summary className={`${row} cursor-pointer list-none hover:bg-paper-2 group-open:bg-paper-2`}>{cells}</summary>
        <div className="grid gap-3 bg-paper-2 px-4 pb-4 pt-1 sm:px-6 md:pl-[calc(1.5rem+3rem+1rem+14rem+1rem)]">
          {f.ja?.text && <p className="label text-ink-3">{t("record.ja")} · <StatusMark status={f.ja.status ?? "active"} review={f.ja.review_status ?? "verified"} t={t} /></p>}
          {f.variants?.length ? (
            <ul className="grid gap-1.5">{f.variants.map((v) => (
              <li key={v.key} className="text-[14px] text-ink-2"><span className="code mr-2 text-ink-3">{v.key} → {(v.for || []).join(", ")}</span>{v.text} <StatusMark status={v.status ?? "active"} review={v.review_status ?? "verified"} t={t} /></li>
            ))}</ul>
          ) : null}
          {editable && <FactActions id={f.id} text={f.text} ja={f.ja?.text ?? null} current={e!.ended === false} owner={owner} l={l} />}
        </div>
      </details>
    </li>
  );
}

export default async function RecordPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireCan("view.profile");
  const { t } = translator(user.lang);
  const want = (await searchParams).tab;
  const tab: Tab = (TABS as readonly string[]).includes(want || "") ? (want as Tab) : "all";
  const { root, facts, manifests, proposals } = await engine();
  const p = facts.loadProfile(root);
  const owner = user.role === "owner";
  const canPropose = allowed(user, "propose.profile");
  const sent = new Map<string, number>();
  for (const m of manifests.readManifests(root)) for (const id of new Set<string>(manifests.sentIds(m))) sent.set(id, (sent.get(id) || 0) + 1);
  const open = new Map<string, number>();
  for (const pr of proposals.openProposals(root)) if (pr.target) open.set(pr.target, (open.get(pr.target) || 0) + 1);
  const entities: Entity[] = p._entities;
  const certs: Fact[] = p.certifications || [];
  const skills: Fact[] = p.skills || [];
  const all: Fact[] = [...p._facts.values()].map((x: { fact: Fact }) => x.fact);
  const live = all.filter((f) => stateOf(f) === "confirmed").length;
  const pending = all.filter((f) => stateOf(f) === "waiting").length;
  const count = (s: Tab) =>
    s === "all" ? all.length : s === "certifications" ? certs.length : s === "skills" ? skills.length
      : entities.filter((e) => e.section === s).reduce((n, e) => n + (e.facts || []).length, 0);
  const l: Record<string, string> = {
    suggestEdit: t("record.suggestEdit"), editDirect: t("record.editDirect"), retire: t("record.retire"), ja: t("record.ja"),
    suggestNew: t("record.suggestNew"), addDirect: t("record.addDirect"), suggestRole: t("record.suggestRole"), addRole: t("record.addRole"),
    submitPropose: t("record.submitPropose"), submitDirect: t("record.submitDirect"),
    newText: t("record.newText"), newJa: t("record.newJa"), reasonRetire: t("record.reasonRetire"),
    tags: t("record.tags"), priority: t("record.priority"), note: t("review.note"), optional: t("common.optional"),
    chars: t("common.chars"), pass: t("review.rules.pass"), figures: t("record.figuresChanged"), working: t("common.loading"),
    roleSection: t("record.roleSection"), roleLabel: t("record.roleLabel"), roleHeading: t("record.roleHeading"), roleTitle: t("record.roleTitle"),
    roleDates: t("record.roleDates"), roleEnded: t("record.roleEnded"),
    ...Object.fromEntries(ENTITY_TABS.map((s) => [`sec_${s}`, t(`record.sections.${s}`)])),
  };

  let n = 0;
  const sections = tab === "all" ? ENTITY_TABS : (ENTITY_TABS as readonly string[]).includes(tab) ? [tab] : [];
  const showLists = tab === "all" || tab === "certifications" || tab === "skills";
  const group = (key: string, label: string, sub?: string, right?: React.ReactNode, id?: string) => (
    <li key={key} id={id} className="sticky top-0 z-[5] md:top-[33px] flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b hair bg-paper px-4 py-2 sm:px-6">
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-3"><span className="heading text-[16px]">{label}</span>{sub && <span className="text-[13.5px] text-ink-3">{sub}</span>}</span>
      {right}
    </li>
  );

  return (
    // The sheet fills the screen and scrolls inside itself, so the page never does.
    <div className="flex h-[calc(100dvh-56px-58px)] flex-col md:h-[calc(100dvh-56px)]">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b-2 rule px-4 py-3 sm:px-6">
        <div className="flex items-baseline gap-4">
          <h1 className="display text-[34px] leading-none sm:text-[40px]">{t("record.title")}</h1>
          <span className="label text-ink-2">{t("record.counts", { live, pending, aside: all.length - live - pending })}</span>
        </div>
        {canPropose && <NewRole owner={owner} l={l} />}
      </div>

      <nav aria-label={t("record.title")} className="scroll-thin flex flex-none overflow-x-auto border-b-2 rule">
        {TABS.map((s) => {
          const on = s === tab;
          return (
            <Link key={s} href={s === "all" ? "/record" : `/record?tab=${s}`} aria-current={on ? "page" : undefined} scroll={false}
              className={`label flex flex-none items-baseline gap-2 border-r hair px-4 py-2.5 ${on ? "bg-ink text-on-ink" : "text-ink-2 hover:bg-paper-2 hover:text-ink"}`}>
              {s === "all" ? t("sys.sheet.all") : t(`section.${s}`)}<span className={on ? "opacity-70" : "text-ink-3"}>{count(s)}</span>
            </Link>
          );
        })}
      </nav>

      <div className="scroll-thin min-h-0 flex-1 overflow-auto">
        <div className={`label sticky top-0 z-10 hidden gap-x-4 border-b-2 rule bg-paper-2 px-4 py-2 text-ink-3 sm:px-6 md:grid ${COLS}`}>
          <span>#</span><span>{t("sys.sheet.id")}</span><span>{t("sys.sheet.statement")}</span><span>{t("record.tags")}</span><span className="text-right">{t("sys.sheet.used")}</span><span>{t("sys.sheet.status")}</span>
        </div>
        <ol>
          {sections.map((s) => {
            const ents = entities.filter((e) => e.section === s);
            if (!ents.length && tab === "all") return null;
            return [
              ...(tab === "all" ? [<li key={`s-${s}`} className="label border-b-2 rule bg-paper-2 px-4 py-1.5 text-ink-2 sm:px-6">{t(`section.${s}`)}</li>] : []),
              ...(ents.length === 0 ? [<li key={`e-${s}`} className="px-4 py-6 text-ink-3 sm:px-6">{t("sys.sheet.empty")}</li>] : []),
              ...ents.flatMap((e) => {
                const st = stateOf(e);
                return [
                  group(`g-${e.id}`, e.heading, [e.title, e.dates].filter(Boolean).join(" · "), st !== "confirmed" ? <Status x={e} reviewKey={`draft:entity:${e.id}`} open={0} t={t} /> : null, e.id),
                  ...(e.facts || []).map((f) => <FactRow key={f.id} f={f} n={++n} e={e} usedBy={sent.get(f.id) || 0} open={open.get(f.id) || 0} owner={owner} canPropose={canPropose} t={t} l={l} />),
                  ...(!(e.facts || []).length ? [<li key={`none-${e.id}`} className="border-b hair px-4 py-2 text-[14px] text-ink-3 sm:px-6">{t("record.noFacts")}</li>] : []),
                  ...(canPropose && st !== "rejected" ? [<li key={`add-${e.id}`} className="border-b hair px-4 py-2 sm:px-6"><NewFact entity={e.id} tags={p.tag_vocabulary || []} current={e.ended === false} owner={owner} l={l} /></li>] : []),
                ];
              }),
            ];
          })}
          {showLists && (tab === "all" || tab === "certifications") && certs.length > 0 && [
            ...(tab === "all" ? [<li key="s-cert" className="label border-b-2 rule bg-paper-2 px-4 py-1.5 text-ink-2 sm:px-6">{t("section.certifications")}</li>] : []),
            ...certs.map((f) => <FactRow key={f.id} f={f} n={++n} e={null} usedBy={sent.get(f.id) || 0} open={open.get(f.id) || 0} owner={owner} canPropose={false} t={t} l={l} />),
          ]}
          {showLists && (tab === "all" || tab === "skills") && skills.length > 0 && [
            ...(tab === "all" ? [<li key="s-skills" className="label border-b-2 rule bg-paper-2 px-4 py-1.5 text-ink-2 sm:px-6">{t("section.skills")}</li>] : []),
            ...skills.map((f) => <FactRow key={f.id} f={f} n={++n} e={null} usedBy={sent.get(f.id) || 0} open={open.get(f.id) || 0} owner={owner} canPropose={false} t={t} l={l} />),
          ]}
          {(tab === "certifications" && !certs.length) || (tab === "skills" && !skills.length) ? <li className="px-4 py-6 text-ink-3 sm:px-6">{t("sys.sheet.empty")}</li> : null}
        </ol>
      </div>
    </div>
  );
}
