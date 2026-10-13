import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { engine } from "@/lib/server/engine";
import { allowed, requireCan } from "@/lib/server/session";
import { formatDate, relative, translator } from "@/lib/i18n";
import type { Packet } from "@/lib/types";
import { Claim } from "@/components/claim";
import { Diff } from "@/components/diff";
import { Findings, Flash, Seal, Stamp } from "@/components/marks";
import { Comments } from "@/components/comments";
import { checkPacketAction, packetStepAction, selectionAction } from "@/app/actions/work";
import { AnswersEditor, BulletEditor, CoverForm } from "../forms";

export const metadata: Metadata = { title: "Packet" };

// The kanji each packet step presses: 提出 submit, 戻す withdraw, 準備 ready, 送信 sent.
const STEP_SEAL: Record<string, string> = { submit: "出", withdraw: "戻", ready: "備", sent: "送" };

function Step({ id, step, label, tone = "btn", children }: { id: number; step: string; label: string; tone?: string; children?: React.ReactNode }) {
  return (
    <form action={packetStepAction} className="grid gap-2">
      <input type="hidden" name="packet" value={id} /><input type="hidden" name="step" value={step} />
      {children}
      <button className={tone}>{STEP_SEAL[step] && <Seal k={STEP_SEAL[step]} />}{label}</button>
    </form>
  );
}

export default async function PacketPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireCan("view.review");
  const { t } = translator(user.lang);
  const { id: raw } = await params;
  const sp = await searchParams;
  const { root, packets, llm } = await engine();
  const pk: Packet | null = packets.getPacket(root, Number(raw), user);
  if (!pk) notFound();
  const owner = user.role === "owner";
  const editable = pk.canEdit;
  const final = pk.manifest?.status === "final";
  const checked = Boolean(pk.manifest?.gates);
  const ai = Boolean(llm.llmEnabled());
  const showGateOutput = allowed(user, "view.evidence-path");
  const archName = pk.archetypes.find((a) => a.id === pk.archetype)?.name || pk.archetype;
  const bl: Record<string, string> = {
    reword: t("packets.reword"), save: t("packets.saveBullet"), suggest: t("packets.suggest"), suggestOff: t("packets.suggestOff"), suggesting: t("packets.suggesting"),
    suggestions: t("packets.suggestions"), use: t("packets.use"), dropped: t("packets.suggestDropped"), cancel: t("common.cancel"),
    chars: t("common.chars"), pass: t("review.rules.pass"), figures: t("record.figuresChanged"), working: t("common.loading"),
  };
  const done = sp.done ? ({ sent: t("packets.sentDone"), ready: t("packets.markReady"), submit: t("packets.submitReview"), withdraw: t("packets.withdraw"), close: t("packets.closePacket") } as Record<string, string>)[sp.done] : null;
  return (
    <div>
      {sp.error && <Flash tone="shu">{sp.error}</Flash>}
      {done && <Flash>{done}</Flash>}
      {pk.status === "changes_requested" && pk.changesNote && (
        <div className="border-b-2 border-shu bg-shu-soft px-4 py-4 sm:px-10">
          <span className="label text-shu">{t("packets.changesNote")}</span>
          <p className="mt-1 text-[16px]">{pk.changesNote}</p>
        </div>
      )}
      <div className="grid gap-4 border-b-2 rule px-4 pb-5 pt-6 sm:px-10">
        <Link href="/packets" className="label text-ink-2">← {t("packets.title")}</Link>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="grid gap-2">
            <h1 className="display text-[36px] sm:text-[52px]">{pk.company}</h1>
            <p className="heading text-[20px] sm:text-[24px]">{pk.role}</p>
            <p className="label text-ink-2">{t("packets.by", { name: pk.author_name })} · {t("packets.updated", { date: relative(pk.updated_at, user.lang) })} · {t("packets.archetype", { name: archName })} · {pk.lang === "ja" ? t("packets.langJa") : t("packets.langEn")}</p>
          </div>
          <div className="flex items-center gap-4">
            <span className={`label border-2 px-3 py-2 ${pk.status === "in_review" ? "border-shu text-shu" : "rule"}`}>{t(`packets.status.${pk.status}`)}</span>
            {final ? <Stamp tone="shu">合格</Stamp> : checked ? <Stamp tone="dashed">未</Stamp> : null}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,7fr)_minmax(340px,5fr)]">
        <section aria-labelledby="cv" className="border-b-2 rule lg:border-b-0 lg:border-r-2">
          <div className="flex items-baseline justify-between border-b-2 rule bg-paper-2 px-4 py-2.5 sm:px-10">
            <h2 id="cv" className="label text-ink-2">{t("packets.cv")}</h2>
            <span className={`label num ${pk.count >= pk.budget ? "text-ink" : "text-ink-2"}`}>{t("packets.bullets", { count: pk.count, budget: pk.budget })}</span>
          </div>
          {!editable && pk.status === "in_review" && <p className="border-b hair px-4 py-3 text-[14px] text-ink-2 sm:px-10">{owner ? "" : t("packets.lockedReview")}</p>}
          {pk.headerGaps.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 rule px-4 py-4 sm:px-10">
              <p className="text-[14px]">{t("packets.headerGap", { fields: pk.headerGaps.map((g) => t(`packets.headerFields.${g}`)).join(" · ") })}</p>
              {owner && <Link href="/record#ja-header" className="btn btn-ghost btn-sm">{t("packets.headerGapFix")}</Link>}
            </div>
          )}
          {pk.missingJa.length > 0 && (
            <div className="grid gap-3 border-b-2 rule bg-shu-soft px-4 py-5 sm:px-10">
              <h3 className="heading text-[20px]">{t("packets.missingJa")} · {pk.missingJa.length}</h3>
              <ul className="grid">
                {pk.missingJa.map((m) => (
                  <li key={m.id} className="grid gap-1 border-t hair py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4">
                    <span className="min-w-0"><span className="code mr-2 text-[11.5px] text-ink-3">{m.id}</span><span className="text-[14px]">{m.text}</span></span>
                    {m.review ? <Link href={`/review?item=${encodeURIComponent(m.review)}`} className="btn btn-ghost btn-sm self-center">{t("packets.missingJaReview")}</Link>
                      : <Link href={`/record#${m.id}`} className="btn btn-ghost btn-sm self-center">{t("packets.missingJaPropose")}</Link>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {pk.sections.map((s) => (
            <div key={s.entity.id} className="border-b-2 rule">
              <div className="px-4 pb-2 pt-5 sm:px-10">
                <h3 className="heading text-[19px]">{s.entity.heading}</h3>
                <p className="text-[14px] text-ink-2">{[s.entity.title, s.entity.dates].filter(Boolean).join(" · ")}</p>
              </div>
              <ol>
                {s.bullets.map((b, i) => (
                  <li key={`${b.id}-${i}`} className="grid gap-2 border-t hair px-4 py-4 sm:px-10">
                    <div className="flex flex-col-reverse gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <p className="min-w-0 text-[15.5px] leading-[1.55]">{b.reworded && b.original ? <Diff before={b.original} after={b.text} /> : <Claim text={b.text} />}</p>
                      <span className="code break-all text-[11px] text-ink-3 sm:max-w-[38%] sm:flex-none sm:text-right">{b.id}</span>
                    </div>
                    {b.problem && <p className="border-l-4 border-shu pl-3 text-[13.5px] text-shu">{b.problem}</p>}
                    {b.lint.length > 0 && <Findings findings={b.lint} t={t} />}
                    {editable && b.id && (
                      <div className="flex flex-wrap items-start gap-x-5 gap-y-2">
                        <BulletEditor packet={pk.id} fact={b.id} text={b.text} current={s.entity.ended === false} ai={ai} ja={pk.lang === "ja"} l={bl} />
                        {(["up", "down", "drop"] as const).map((a) => (
                          <form key={a} action={selectionAction}>
                            <input type="hidden" name="packet" value={pk.id} /><input type="hidden" name="fact" value={b.id!} /><input type="hidden" name="action" value={a} />
                            <button className="label text-ink-2 hover:text-ink" aria-label={`${t(`packets.${a}`)}: ${b.id}`}>{a === "up" ? "↑" : a === "down" ? "↓" : t("packets.drop")}</button>
                          </form>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          ))}
          {editable && pk.pool.length > 0 && (
            <details className="border-b-2 rule">
              <summary className="flex cursor-pointer items-baseline justify-between px-4 py-3 hover:bg-paper-2 sm:px-10">
                <span className="label text-ink-2">{t("packets.pool")} · {pk.pool.length}</span>
                <span className="text-[13px] text-ink-3">{pk.count >= pk.budget ? t("packets.budgetFull", { budget: pk.budget }) : null}</span>
              </summary>
              <ul>
                {pk.pool.map((f) => (
                  <li key={f.id} className="grid gap-2 border-t hair px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:px-10">
                    <div className="grid gap-1">
                      <span className="code text-[11.5px] text-ink-3">{f.entityLabel} · {f.id} · {f.score}</span>
                      <span className="text-[14.5px]"><Claim text={f.text} /></span>
                    </div>
                    <form action={selectionAction} className="self-center">
                      <input type="hidden" name="packet" value={pk.id} /><input type="hidden" name="fact" value={f.id} /><input type="hidden" name="action" value="add" />
                      <button className="btn btn-ghost btn-sm" disabled={pk.count >= pk.budget}>+ {t("packets.add")}</button>
                    </form>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="flex flex-wrap gap-3 px-4 py-5 sm:px-10">
            <a className="btn btn-ghost btn-sm" href={`/packets/${pk.id}/download`}>{t("packets.download")}</a>
            <Link className="btn btn-ghost btn-sm" href={`/print/packet/${pk.id}`} target="_blank">{t("packets.print")}</Link>
          </div>
        </section>

        <aside className="grid content-start">
          <section id="check" aria-labelledby="check-h" className="scroll-mt-20 grid gap-4 border-b-2 rule px-4 py-6 sm:px-8">
            <h2 id="check-h" className="heading text-[22px]">{t("packets.check")}</h2>
            {checked ? (
              <div className="grid gap-3">
                <p className={`font-bold ${final ? "" : "text-shu"}`}>{final ? t("packets.passed") : t("packets.failed")}</p>
                <ul className="grid border-2 rule">
                  {pk.manifest!.gates!.map((g) => (
                    <li key={g.name} className="grid gap-1 border-b hair px-3 py-2 last:border-b-0">
                      <span className="flex justify-between"><span className="label">{t(`packets.gates.${g.name}`)}</span><span className={`label ${g.ok ? "" : "text-shu"}`}>{g.ok ? t("packets.pass") : t("packets.fail")}</span></span>
                      {!g.ok && showGateOutput && g.out && <pre className="code scroll-thin max-h-48 overflow-auto whitespace-pre-wrap text-[11.5px] text-ink-2">{g.out}</pre>}
                    </li>
                  ))}
                </ul>
                {(pk.manifest!.problems || []).length > 0 && <ul className="grid gap-1.5">{pk.manifest!.problems!.map((x, i) => <li key={i} className="border-l-4 border-shu pl-3 text-[13.5px] text-shu">{x}</li>)}</ul>}
              </div>
            ) : <p className="label text-ink-3">{t("packets.notChecked")}</p>}
            {allowed(user, "packet.edit") && pk.status !== "sent" && pk.status !== "closed" && (
              <form action={checkPacketAction}><input type="hidden" name="packet" value={pk.id} /><button className="btn"><Seal k="検" />{t("packets.check")}</button></form>
            )}
          </section>

          <section aria-label={t("packets.title")} className="grid gap-4 border-b-2 rule px-4 py-6 sm:px-8">
            {!owner && (pk.status === "drafting" || pk.status === "changes_requested") && allowed(user, "packet.edit") && (
              <><Step id={pk.id} step="submit" label={t("packets.submitReview")} tone="btn btn-shu" /></>
            )}
            {pk.status === "in_review" && !owner && pk.created_by === user.id && <Step id={pk.id} step="withdraw" label={t("packets.withdraw")} tone="btn btn-ghost" />}
            {pk.status === "in_review" && owner && <Link href={`/review?item=${encodeURIComponent(`packet:${pk.id}`)}`} className="btn btn-shu justify-self-start"><Seal k="承" />{t("review.out.approve")} / {t("review.out.changes")} →</Link>}
            {owner && (pk.status === "drafting" || pk.status === "changes_requested") && (
              <><Step id={pk.id} step="ready" label={t("packets.markReady")} tone={final ? "btn btn-shu" : "btn btn-ghost"} /></>
            )}
            {owner && pk.status === "ready" && (
              <Step id={pk.id} step="sent" label={t("packets.sent")} tone="btn btn-shu">
                <label className="grid gap-1.5"><span className="label text-ink-2">{t("packets.sentOn")}</span><input type="date" name="on" defaultValue={new Date().toISOString().slice(0, 10)} className="field max-w-[220px]" /></label>
              </Step>
            )}
            {pk.status === "sent" && <p className="flex items-center gap-4"><Stamp tone="ink">送信</Stamp><span className="label">{t("packets.status.sent")} · {formatDate(pk.sent_on, user.lang)}{pk.tracker_num ? ` · #${pk.tracker_num}` : ""}</span></p>}
            {pk.status !== "closed" && pk.status !== "sent" && (owner || pk.created_by === user.id) && (
              <Step id={pk.id} step="close" label={t("packets.closePacket")} tone="label justify-self-start text-ink-3 underline underline-offset-4 hover:text-ink" />
            )}
          </section>

          <section aria-labelledby="answers-h" className="grid gap-4 border-b-2 rule px-4 py-6 sm:px-8">
            <h2 id="answers-h" className="heading text-[22px]">{t("packets.answers")}</h2>
            <AnswersEditor packet={pk.id} lang={pk.lang} editable={editable} initial={pk.answers.map(({ check: _c, ...a }) => a)} checks={pk.answers.map((a) => a.check)} l={{
              question: t("packets.question"), limit: t("packets.limit"), unit: t("packets.unit"), chars: t("packets.chars"), words: t("packets.words"), answer: t("packets.answer"),
              removeAnswer: t("packets.removeAnswer"), saveAnswers: t("packets.saveAnswers"), addAnswer: t("packets.addAnswer"), used: t("packets.used"),
              over: t("packets.over"), underFilled: t("packets.underFilled"), figureFlag: t("packets.figureFlag"), working: t("common.loading"),
            }} />
          </section>

          <section aria-label={t("packets.cover")} className="grid gap-4 border-b-2 rule px-4 py-6 sm:px-8">
            {pk.coverCheck.length > 0 && (
              <ul className="grid gap-2">{pk.coverCheck.map((c, i) => <li key={i} className="border-l-4 border-shu pl-3 text-[13.5px] text-shu">{t("packets.coverFlag", { figs: c.figures.join(", "), sentence: c.sentence })}</li>)}</ul>
            )}
            {editable ? (
              <CoverForm packet={pk.id} cover={pk.cover_letter || ""} notes={pk.notes || ""} l={{
                cover: t("packets.cover"), coverHelp: t("packets.coverHelp"), saveCover: t("packets.saveCover"), notes: t("packets.notes"), saveNotes: t("packets.saveNotes"), working: t("common.loading"),
              }} />
            ) : (
              <>
                <h2 className="label text-ink-2">{t("packets.cover")}</h2>
                <p className="whitespace-pre-line text-[14.5px]">{pk.cover_letter || "–"}</p>
                {pk.notes && <><h2 className="label text-ink-2">{t("packets.notes")}</h2><p className="whitespace-pre-line text-[14.5px]">{pk.notes}</p></>}
              </>
            )}
          </section>

          <details className="border-b-2 rule px-4 py-4 sm:px-8">
            <summary className="label cursor-pointer text-ink-2">{t("packets.jd")}</summary>
            {pk.url && <a href={pk.url} target="_blank" rel="noreferrer noopener" className="link mt-3 block break-all text-[14px]">{pk.url}</a>}
            <pre className="code scroll-thin mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap text-[12.5px] leading-[1.6] text-ink-2">{pk.jdText || t("packets.jdNone")}</pre>
          </details>

          <div className="px-4 py-6 sm:px-8"><Comments subject={`packet:${pk.id}`} user={user} path={`/packets/${pk.id}`} /></div>
        </aside>
      </div>
    </div>
  );
}
