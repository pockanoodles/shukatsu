import type { Lang } from "@/lib/i18n";

/** An event as core/events.mjs stores it. */
export type CalEvent = {
  id: number; kind: string; title: string; starts_at: string; ends_at: string | null; all_day: number; timezone: string;
  location: string | null; meeting_url: string | null; tracker_num: number | null; campaign_id: number | null; round: string | null;
  note: string | null; source: string | null; done_at: string | null; cancelled_at: string | null;
};

const SHORT: Record<string, string> = { "Asia/Tokyo": "JST", "America/New_York": "ET", "America/Chicago": "CT", "America/Los_Angeles": "PT", UTC: "UTC" };
export const zoneShort = (tz: string) => SHORT[tz] || tz.split("/").pop()!.replace(/_/g, " ");

/** The zone the candidate lives in: this machine's, unless SHUKATSU_TZ says otherwise. */
export const homeZone = () => process.env.SHUKATSU_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";

const loc = (lang: Lang) => (lang === "ja" ? "ja-JP" : "en-US");

/** Sunday to Saturday, as the weekday numbers core/ uses (0 is Sunday). 2026-01-04 was a Sunday. */
export const weekdayNames = (lang: Lang) =>
  Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(loc(lang), { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 4 + i))));

export function fmtDay(iso: string, lang: Lang, tz = homeZone()) {
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return new Intl.DateTimeFormat(loc(lang), { weekday: "short", month: "short", day: "numeric", timeZone: iso.length === 10 ? "UTC" : tz }).format(d);
}

export function fmtTime(iso: string, lang: Lang, tz: string) {
  return new Intl.DateTimeFormat(loc(lang), { hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date(iso));
}

/** The calendar day an event falls on in the home zone, for grouping. */
export function dayKey(e: CalEvent, tz = homeZone()) {
  if (e.all_day) return e.starts_at.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(e.starts_at));
}

/**
 * How an event reads: in the home zone, and, when it was written in another
 * zone, as posted too ("8:00 AM JST, Oct 26"), since that's the wording the
 * employer will hold the candidate to.
 */
export function when(e: CalEvent, lang: Lang, tz = homeZone()) {
  if (e.all_day) return { day: fmtDay(e.starts_at, lang), time: null as string | null, posted: null as string | null };
  const time = `${fmtTime(e.starts_at, lang, tz)}${e.ends_at && e.ends_at !== e.starts_at ? `–${fmtTime(e.ends_at, lang, tz)}` : ""}`;
  const posted = e.timezone !== tz ? `${fmtTime(e.starts_at, lang, e.timezone)} ${zoneShort(e.timezone)}, ${fmtDay(e.starts_at, lang, e.timezone)}` : null;
  return { day: fmtDay(e.starts_at, lang, tz), time: `${time} ${zoneShort(tz)}`, posted };
}

/** Hours until an event starts (negative once it's past). An all-day deadline counts to the end of its day (UTC, close enough for "how soon"). */
export function hoursLeft(e: CalEvent) {
  const at = e.all_day ? Date.parse(`${e.starts_at}T23:59:59Z`) : Date.parse(e.starts_at);
  return (at - Date.now()) / 3_600_000;
}

/** "3 days" / "5 hours" left, in words. */
export function leftText(e: CalEvent, lang: Lang) {
  const h = hoursLeft(e);
  const rtf = new Intl.RelativeTimeFormat(loc(lang), { numeric: "auto" });
  if (Math.abs(h) < 48) return rtf.format(Math.round(h), "hour");
  return rtf.format(Math.round(h / 24), "day");
}

/** Every IANA zone the runtime knows, for a picker; the common ones first. */
export function zones(): string[] {
  const first = ["America/New_York", "Asia/Tokyo", "America/Chicago", "America/Los_Angeles", "Europe/London", "UTC"];
  const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return [...first, ...all.filter((z) => !first.includes(z))];
}
