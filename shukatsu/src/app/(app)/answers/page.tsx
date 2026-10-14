import type { Metadata } from "next";
import { requireCan } from "@/lib/server/session";
import { read } from "@/lib/server/op";
import { relative, translator } from "@/lib/i18n";
import { Flash, Head } from "@/components/marks";
import { AnswerForm, CountryForm, QuestionForm, SuggestionForm, type Target } from "./forms";

export const metadata: Metadata = { title: "Form answers" };

type Key = {
  key: string; sensitive: boolean; per_country: boolean; stated: string | null;
  countries: { country: string; value: string }[]; profile: { value: string; source: string } | null;
};
type Suggestion = { id: number; target: Target; value: string; label: string; host: string; sensitive: boolean; at: string };
type Answers = { keys: Key[]; questions: { q: string; a: string }[]; untrusted: { suggestions: Suggestion[] } };

const DEMOGRAPHIC = ["salary", "pronouns", "eeo.gender", "eeo.race", "eeo.hispanic", "eeo.veteran", "eeo.disability"];

export default async function AnswersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireCan("answers.manage");
  const done = (await searchParams).done;
  const { t } = translator(user.lang);
  const data = await read<Answers>("answers.get");
  const by = new Map(data.keys.map((k) => [k.key, k]));
  const work = by.get("auth.work")!;
  const sponsor = by.get("auth.sponsorship")!;
  const countries = [...new Set([...work.countries, ...sponsor.countries].map((c) => c.country))];
  const valueIn = (k: Key, country: string) => k.countries.find((c) => c.country === country)?.value || "";
  const l = {
    save: t("common.save"), clear: t("answers.clear"), working: t("common.loading"), add: t("answers.questions.add"),
    q: t("answers.questions.q"), a: t("answers.questions.a"),
    country: t("answers.auth.country"), work: t("answers.auth.work"), sponsorship: t("answers.auth.sponsorship"), countryHint: t("answers.auth.countryHint"), blank: t("answers.auth.blank"),
    accept: t("answers.suggested.accept"), dismiss: t("answers.suggested.dismiss"), as: t("answers.suggested.as"),
  };
  const keyLabel = (key: string) => t(`answers.keys.${key}`);
  const targetLabel = (s: Target) => s.question ? t("answers.suggested.question") : `${keyLabel(s.key!)}${s.country ? ` · ${s.country}` : ""}`;
  const one = (k: Key) => (
    <AnswerForm key={k.key} target={{ key: k.key }} label={keyLabel(k.key)} value={k.stated || ""} l={l}
      placeholder={k.profile ? t("answers.fromProfile", { value: k.profile.value }) : undefined}
      list={k.key.startsWith("eeo.") ? [t("answers.hints.decline")] : undefined} />
  );
  const sections = "grid content-start gap-4 border-b-2 rule px-4 py-8 sm:px-10";
  const plain = [work, sponsor].filter((k) => k.stated);
  const suggestions = data.untrusted.suggestions.slice().reverse();

  return (
    <div>
      {(done === "accepted" || done === "dismissed") && <Flash>{t(`answers.${done}`)}</Flash>}
      <Head eyebrow={t("answers.eyebrow")} title={t("answers.title")} lead={t("answers.lead")} />
      {suggestions.length > 0 && (
        <section className={sections}>
          <h2 className="heading text-[22px]">{t("answers.suggested.title")} · {suggestions.length}</h2>
          <p className="max-w-3xl text-[15px] text-ink-2">{t("answers.suggested.lead")}</p>
          <ul className="border-t hair">
            {suggestions.map((s) => (
              <li key={s.id} className="grid gap-2 border-b hair py-4">
                <p className="font-medium break-words">{s.label || targetLabel(s.target)}</p>
                <p className="label text-ink-3">{t("answers.suggested.from", { host: s.host })} · {relative(s.at, user.lang)} · {t("answers.suggested.as")}: {targetLabel(s.target)}</p>
                {s.sensitive && <p className="text-[14px] text-shu">{t("answers.suggested.sensitive")}</p>}
                <SuggestionForm id={s.id} target={s.target} value={s.value} l={l} />
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="grid lg:grid-cols-2">
        <section className={`${sections} lg:col-span-2`}>
          <h2 className="heading text-[22px]">{t("answers.auth.title")}</h2>
          <p className="max-w-3xl text-[15px] text-ink-2">{t("answers.auth.lead")}</p>
          {plain.map((k) => <p key={k.key} className="max-w-3xl border-l-2 rule pl-4 text-[14px] text-shu">{keyLabel(k.key)}: {t("answers.auth.plain", { value: k.stated })}</p>)}
          <div className="max-w-4xl border-t hair">
            {countries.length === 0 && <p className="border-b hair py-3 text-ink-3">{t("answers.auth.none")}</p>}
            {countries.map((c) => <CountryForm key={c} country={c} work={valueIn(work, c)} sponsorship={valueIn(sponsor, c)} l={l} />)}
            <CountryForm l={l} />
          </div>
        </section>
        <section className={`${sections} lg:border-r-2`}>
          <h2 className="heading text-[22px]">{t("answers.sensitive.title")}</h2>
          <p className="text-[15px] text-ink-2">{t("answers.sensitive.lead")}</p>
          <div className="border-t hair">{DEMOGRAPHIC.map((k) => by.get(k)).filter((k): k is Key => Boolean(k)).map(one)}</div>
        </section>
        <section className={sections}>
          <h2 className="heading text-[22px]">{t("answers.other.title")}</h2>
          <p className="text-[15px] text-ink-2">{t("answers.other.lead")}</p>
          <div className="border-t hair">{data.keys.filter((k) => !k.per_country && !DEMOGRAPHIC.includes(k.key)).map(one)}</div>
        </section>
        <section className={`${sections} lg:col-span-2`}>
          <h2 className="heading text-[22px]">{t("answers.questions.title")}</h2>
          <p className="max-w-3xl text-[15px] text-ink-2">{t("answers.questions.lead")}</p>
          <div className="max-w-5xl border-t hair">
            {data.questions.length === 0 && <p className="border-b hair py-3 text-ink-3">{t("answers.questions.none")}</p>}
            {data.questions.map((q) => <QuestionForm key={q.q} question={q.q} answer={q.a} l={l} />)}
            <QuestionForm l={l} />
          </div>
        </section>
      </div>
    </div>
  );
}
