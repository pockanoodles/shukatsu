import "server-only";
import type { T } from "@/lib/i18n";

// Engine messages people hit often, so a Japanese reader sees Japanese.
const JA: [RegExp, string][] = [
  [/You do not have permission/, "この操作をする権限がありません。"],
  [/Say why, in a few words/, "理由をひとこと書いてください。提案した人にも表示されます。"],
  [/drop the figures in question \(([^)]*)\)/, "数字なしで残すには、該当する数字（$1）を外してください。"],
  [/A variant must carry the same figures/, "言い換えは元の実績と同じ数字にしてください。数字を変えるには元の実績を直します。"],
  [/That change would break the profile/, "この変更は実績のルールに反します。"],
  [/one-page budget is (\d+)/, "1ページに入るのは$1件です。先に1件外してください。"],
  [/Only confirmed facts can go on a resume/, "書類に載せられるのは確認済みの実績だけです。"],
  [/Run the check first|hasn't passed (its|the) check/, "先にチェックを実行して、合格させてください。"],
  [/waiting for review\. Withdraw it/, "本人が確認中です。編集するには依頼を取り下げてください。"],
  [/already suggested that posting/, "その求人はすでに提案されています。"],
  [/isn't a link to a posting/, "求人ページのリンクではないようです。"],
  [/is locked by another writer/, "ほかの保存処理が進行中です。少し待ってからもう一度お試しください。"],
  [/The wording is empty/, "表現が空です。"],
  [/already decided/, "この項目はすでに判断済みです。"],
];

/** A message a person can act on, in their language. */
export function errorText(e: unknown, t: T, lang: string): string {
  const err = e as { code?: string; status?: number; message?: string };
  if (err?.code) {
    for (const ns of ["login", "invite"]) {
      const msg = t(`${ns}.${err.code}`);
      if (msg !== `${ns}.${err.code}`) return msg;
    }
  }
  const message = String(err?.message || e);
  if (lang === "ja") {
    for (const [re, ja] of JA) {
      const m = message.match(re);
      if (!m) continue;
      // Keep the rule details a blocked edit lists after its first line.
      const details = message.split("\n").slice(1).join("\n");
      return `${ja.replace(/\$(\d)/g, (_, n) => m[Number(n)] ?? "")}${details ? `\n${details}` : ""}`;
    }
  }
  // A blocked edit lists the rule problems on the following lines; keep them.
  return message;
}
