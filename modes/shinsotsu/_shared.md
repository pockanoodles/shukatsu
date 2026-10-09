# 新卒 (shinsotsu) market rules -- shukatsu

<!-- System layer, owned by the shukatsu fork (not an upstream career-ops file, so
     update-system.mjs never touches it). Personal data goes in the user layer.

     Upstream's modes/ja/ covers mid-career 転職 (doda, Wantedly, 正社員 vs
     業務委託). This directory covers the other Japanese market: student hiring
     (新卒採用, 長期/サマーインターン), including bilingual forums like the Boston
     Career Forum on CareerForum.Net (CFN). Load it in addition to modes/_shared.md,
     never instead of it. Every source-of-truth and no-fabrication guardrail there
     still applies. -->

## When this applies

Load this file when any of these is true:
- The posting is on CareerForum.Net (CFN) or for the Boston / Tokyo / London Career Forum.
- The hiring entity is Japanese, or the role is in a Japan office, and it is a student
  role (新卒, インターン, 長期インターン, サマーインターン, 本選考).
- The form asks for any of 自己PR, ガクチカ, 志望動機, 学生時代に力を入れたこと, エントリーシート (ES).
- The candidate asks for Japanese application text.

English-language roles at Japanese companies outside these cases use the default modes.

## How 新卒 screening differs (score and write with this in mind)

- **Potential, not track record.** ポテンシャル採用 screens on self-analysis (自己分析),
  motivation, and how the candidate thinks. Transcripts and GPA weigh far less than in
  US screening, so never volunteer GPA in Japanese text.
- **The ES is read by a human.** Answers get judged on structure (結論 first), concrete
  episodes, and whether the 志望動機 could only have been written for this company.
  A generic 志望動機 is the most common rejection reason, so every one must name
  something specific to the company (a business line, a product, a stated value, a
  person met at a booth) and connect it to the candidate's own episode.
- **Selection runs in rounds.** ES → 適性検査 (SPI / 玉手箱 / TG-WEB) → 一次面接 →
  二次面接 → 最終面接 → 内々定 / 内定. At career forums the rounds compress into the
  event days, and ~80% of the result is decided in the online application round before
  the forum.
- **Fill the box.** Write to 80–100% of a character limit. Under 80% reads as low effort.
  Check every answer with `node shukatsu/char-count.mjs --limit N` before showing it.

## Vocabulary the candidate's materials must use

| Don't write | Write | Why |
|---|---|---|
| co-op, コープ | 6ヶ月の長期インターン（2027年1月〜6月） | "co-op" doesn't parse for a Japanese employer |
| a GPA figure | nothing, unless the form demands it | GPA isn't the screen here, and a weak one only hurts |
| 本番導入, リリースしました (for unshipped work) | 本番環境への導入に向けたレビュー段階 / 社内検証まで実施 | the source guards forbid production claims that aren't true |
| マイナー, 副専攻 (unless declared) | the declared 専攻 only | an undeclared minor is a false claim |

## Register and style

- Default to **です・ます調** for ES and CFN free-text. Use **だ・である調** only when the
  form or company template clearly expects it. Never mix the two in one answer, and
  `char-count.mjs` flags a mix.
- **結論ファースト**: the first sentence answers the question. Then the episode
  (状況 → 課題 → 行動 → 結果), then what it means for this company.
- Numbers stay exactly as the sources state them (article-digest.md wins over cv.md).
  Write each one with a Japanese gloss of what it means, in the same sentence.
- No em dashes, no semicolons, no smart quotes. Full-width punctuation （、。「」） in
  Japanese text, and half-width digits.

## Document types

| Document | What it is | Where it comes from |
|---|---|---|
| CFN My Resume (EN / JA) | Typed into CFN fields with per-field character limits, no upload | `cv.md` + `article-digest.md`, re-cut per field |
| 履歴書 | Standard JP resume form (学歴・職歴, 資格, 自己PR, 志望動機) | Same sources. 学歴 in chronological order, 資格 lists CFA Level I受験予定 only as registered |
| 職務経歴書 | Work history in detail (職務要約, 職務内容, 活かせる経験・知識) | `article-digest.md` sections, one per role |
| ES answers | Company-specific questions with limits | `interview-prep/story-bank.md` episodes + company research |

## Character limits

Never guess a limit. Ask the candidate, read it off the form, or read it from
`{DATA_ROOT}/config/shinsotsu-limits.yml` if the field has been recorded there. Record
any newly seen limit there so the next application reuses it.
