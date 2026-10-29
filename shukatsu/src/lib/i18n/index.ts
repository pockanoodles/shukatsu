import base, { type Dict } from "./en";
import baseJa from "./ja";
import sysEn from "./system.en";
import sysJa from "./system.ja";
import connectorsEn from "./connectors.en";
import connectorsJa from "./connectors.ja";
import oauthEn from "./oauth.en";
import oauthJa from "./oauth.ja";
import answersEn from "./answers.en";
import answersJa from "./answers.ja";
import asksEn from "./asks.en";
import asksJa from "./asks.ja";

export type Lang = "en" | "ja";
// The original dictionary plus one per area of the headless system, each owning its own top-level keys.
const en = { ...base, ...sysEn, ...connectorsEn, ...oauthEn, ...answersEn, ...asksEn } as Dict & typeof sysEn;
const ja = { ...baseJa, ...sysJa, ...connectorsJa, ...oauthJa, ...answersJa, ...asksJa };
export const DICTS: Record<Lang, unknown> = { en, ja };

type Vars = Record<string, string | number | null | undefined>;

/**
 * Walk a dotted key. Some keys themselves contain dots (review.q has
 * "proposal.fact.edit"), so at each level the longest matching key wins.
 */
function lookup(dict: unknown, key: string): unknown {
  const parts = key.split(".");
  let node: unknown = dict;
  let i = 0;
  while (i < parts.length) {
    if (!node || typeof node !== "object") return undefined;
    const obj = node as Record<string, unknown>;
    let j = parts.length;
    while (j > i && !(parts.slice(i, j).join(".") in obj)) j--;
    if (j === i) return undefined;
    node = obj[parts.slice(i, j).join(".")];
    i = j;
  }
  return node;
}

export const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? "" : String(vars[k]))) : s);

/**
 * A translator for one language. A missing key falls back to English, then to
 * the key itself, so a gap shows up as readable text instead of a crash.
 */
export function translator(lang: Lang) {
  const t = (key: string, vars?: Vars): string => {
    const hit = lookup(DICTS[lang], key) ?? lookup(en, key);
    return typeof hit === "string" ? fill(hit, vars) : key;
  };
  /** Structured entries (lists of pairs, nested maps), typed by the English shape. */
  const list = <T,>(key: string): T => (lookup(DICTS[lang], key) ?? lookup(en, key)) as T;
  return { t, list, lang };
}

export type T = ReturnType<typeof translator>["t"];

export function formatDate(iso: string | null | undefined, lang: Lang, withTime = false): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === "ja" ? "ja-JP" : "en-US", {
    month: "short", day: "numeric", year: "numeric", ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(d);
}

export function relative(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return "";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  const rtf = new Intl.RelativeTimeFormat(lang === "ja" ? "ja-JP" : "en-US", { numeric: "auto" });
  if (s < 60) return rtf.format(-Math.round(s), "second");
  if (s < 3600) return rtf.format(-Math.round(s / 60), "minute");
  if (s < 86400) return rtf.format(-Math.round(s / 3600), "hour");
  if (s < 86400 * 30) return rtf.format(-Math.round(s / 86400), "day");
  return formatDate(iso, lang);
}
