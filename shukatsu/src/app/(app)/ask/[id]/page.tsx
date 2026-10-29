import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireCan } from "@/lib/server/session";
import { read } from "@/lib/server/op";
import { relative, translator } from "@/lib/i18n";
import { Diff } from "@/components/diff";
import { Flash, Stamp } from "@/components/marks";
import { Submit } from "@/components/client";
import { cancelAskAction, closeAskAction } from "@/app/actions/asks";
import { AskReply } from "./reply";

export const metadata: Metadata = { title: "Ask" };

type Ask = {
  id: number; subject: string; item: "answer" | "ja"; asked_by_name: string; asked_of_name: string; note: string | null;
  base: { company?: string; role?: string; lang?: string; question?: string; limit?: number | null; unit?: "chars" | "words"; text: string; heading?: string | null; en?: string };
  status: "open" | "answered" | "closed" | "cancelled"; outcome: "used" | "not_used" | "fine" | null;
  reply: string | null; reply_note: string | null; close_note: string | null; nudge: "sent" | "failed" | "unlinked" | null;
  result: { text?: string; edited?: boolean } | null; proposal: { id: number; status: string; text: string } | null; created_at: string;
};

/** A quoted note from one person to the other. */
function Said({ text }: { text: string | null }) {
  return text ? <p className="border-l-4 border-shu pl-3 text-[16px] leading-[1.7]">{text}</p> : null;
}

/**
 * One ask, on a phone first. The person asked sees the item, their reply
 * form, and in the end what came of it; the candidate sees the reply against
 * the item as it was, and uses it or doesn't.
 */
export default async function AskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireCan("view.review");
  const { t } = translator(user.lang);
  const { id } = await params;
  const sp = await searchParams;
  const k = await read<Ask>("ask.get", { id: Number(id) }).catch(() => null);
  if (!k) notFound();
  const owner = user.role === "owner";
  const lang = k.base.lang || (k.item === "ja" ? "ja" : "en");
  const answer = k.item === "answer";
  const theirs = k.proposal?.text ?? k.reply;
  const live = k.status === "open" || k.status === "answered";
  const showCurrent = owner ? k.status === "open" || (!live && k.outcome !== "used") : !live && k.outcome !== "used";
  const counter = (name: string) => ({ name });
  const l = {
    yours: t("asks.yours"), yourNote: t("asks.yourNote", counter(k.asked_by_name)), submit: t("asks.submit"), fine: t("asks.fine"),
    used: t("asks.used"), over: t("asks.over"), underFilled: t("asks.underFilled"), chars: t("asks.chars"), words: t("asks.words"),
  };
  const flash = sp.error ? null : sp.replied ? (k.outcome === "fine" ? t("asks.repliedFine") : t("asks.replied", counter(k.asked_by_name)))
    : sp.closed ? t("asks.closed", counter(k.asked_of_name)) : sp.cancelled ? t("asks.cancelled") : null;

  return (
    <div>
      {sp.error && <Flash tone="shu">{sp.error}</Flash>}
      {flash && <Flash>{flash}</Flash>}

      <section className="grid gap-5 border-b-2 rule px-4 py-8 sm:px-10">
        <div className="flex items-start justify-between gap-4">
          <div className="grid gap-2">
            <span className="label text-ink-2">{owner ? t("asks.eyebrowOwner") : t("asks.eyebrow")} · {answer ? t("asks.kindAnswer") : t("asks.kindJa")}</span>
            <h1 className="heading text-[26px] leading-[1.35] sm:text-[32px]" lang={answer ? lang : undefined}>{answer ? k.base.question : k.base.heading || t("asks.kindJa")}</h1>
            <p className="text-[14px] text-ink-2">
              {answer && [k.base.company, k.base.role].filter(Boolean).join(" · ")}
              {answer && " · "}
              {owner ? t("asks.to", counter(k.asked_of_name)) : t("asks.from", counter(k.asked_by_name))} · {relative(k.created_at, user.lang)}
            </p>
          </div>
          {live ? <Stamp tone={k.status === "answered" ? "ink" : "shu"} size="sm">{k.status === "answered" ? "返" : "頼"}</Stamp>
            : <Stamp tone={k.outcome === "used" ? "shu" : "dashed"} size="sm">{k.status === "cancelled" ? "取" : k.outcome === "used" ? "採" : k.outcome === "fine" ? "可" : "見"}</Stamp>}
        </div>
        <Said text={k.note} />
      </section>

      {k.item === "ja" && k.base.en && (
        <section className="grid gap-2 border-b-2 rule px-4 py-6 sm:px-10">
          <span className="label text-ink-2">{t("asks.english")}</span>
          <p className="text-[16px] leading-[1.7]">{k.base.en}</p>
        </section>
      )}

      {/* The item as it was asked, once: the reply box already holds it, a reply is shown as a diff against it, and a used reply replaces it. */}
      {showCurrent && (
        <section className="grid gap-2 border-b-2 rule px-4 py-6 sm:px-10">
          <span className="label text-ink-2">{t("asks.current")}</span>
          <p lang={lang} className="whitespace-pre-wrap text-[17px] leading-[1.8]">{k.base.text || "–"}</p>
        </section>
      )}
      {!owner && k.status === "answered" && (
        <details className="border-b-2 rule px-4 py-4 sm:px-10">
          <summary className="label cursor-pointer text-ink-2">{t("asks.current")}</summary>
          <p lang={lang} className="mt-2 whitespace-pre-wrap text-[16px] leading-[1.8] text-ink-2">{k.base.text || "–"}</p>
        </details>
      )}

      {/* The person asked: answer, or answer again until the candidate decides. */}
      {!owner && live && (
        <section className="grid gap-4 px-4 py-6 sm:px-10">
          {k.status === "answered" && <p className="text-[14px] text-ink-2">{k.item === "ja" ? t("asks.reviewJa", counter(k.asked_by_name)) : t("asks.again", counter(k.asked_by_name))}</p>}
          <AskReply id={k.id} initial={theirs ?? k.base.text} lang={lang} limit={answer ? k.base.limit ?? null : null} unit={k.base.unit || "chars"} multiline={answer} l={l} />
        </section>
      )}

      {/* The candidate: what came back, and what to do with it. */}
      {owner && live && (
        <section className="grid gap-5 px-4 py-6 sm:px-10">
          {k.nudge && <p className="label text-ink-3">{t(`asks.line.${k.nudge}`, counter(k.asked_of_name))}</p>}
          {k.status === "answered" ? (
            <>
              <div className="grid gap-2">
                <span className="label text-ink-2">{t("asks.theirReply", counter(k.asked_of_name))}</span>
                <p lang={lang} className="whitespace-pre-wrap text-[17px] leading-[1.8]">{theirs ? <Diff before={k.base.text} after={theirs} /> : t("asks.noChange")}</p>
                <Said text={k.reply_note} />
              </div>
              {answer ? (
                <form action={closeAskAction} className="grid gap-3">
                  <input type="hidden" name="id" value={k.id} />
                  <label className="grid gap-1.5"><span className="label text-ink-2">{t("asks.closeNote", counter(k.asked_of_name))}</span>
                    <input name="note" maxLength={1000} placeholder={t("asks.closeNotePlaceholder")} className="field" /></label>
                  <div className="grid gap-3 sm:flex">
                    <Submit className="btn" name="outcome" value="used">{t("asks.use")}</Submit>
                    <Submit className="btn btn-ghost" name="outcome" value="not_used">{t("asks.notUse")}</Submit>
                  </div>
                </form>
              ) : k.proposal && <Link href={`/review?item=${encodeURIComponent(`proposal:${k.proposal.id}`)}`} className="btn justify-self-start">{t("asks.decideInReview")} →</Link>}
            </>
          ) : <p className="text-[15px] text-ink-2">{t("asks.state.open")}</p>}
          <form action={cancelAskAction}><input type="hidden" name="id" value={k.id} /><Submit className="label text-ink-3 underline underline-offset-4 hover:text-ink">{t("asks.cancel")}</Submit></form>
        </section>
      )}

      {/* Both: what came of it. */}
      {!live && (
        <section className="grid gap-4 px-4 py-6 sm:px-10">
          <p className="heading text-[20px]">{k.status === "cancelled" ? t("asks.outcomeLead.cancelled", counter(k.asked_by_name)) : t(`asks.outcomeLead.${k.outcome}`, counter(k.asked_by_name))}</p>
          <Said text={k.outcome === "fine" ? k.reply_note : k.close_note} />
          {k.outcome === "used" && k.result?.text && (
            <div className="grid gap-2">
              <span className="label text-ink-2">{t("asks.final")}</span>
              <p lang={lang} className="whitespace-pre-wrap text-[17px] leading-[1.8]">{k.result.text}</p>
              {k.result.edited && <p className="text-[14px] text-ink-2">{t("asks.edited", counter(k.asked_by_name))}</p>}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
