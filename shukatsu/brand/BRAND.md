# Shukatsu brand: Ledger

One brand for the app (`shukatsu/src`) and the product page (`site/`, kaitosoeno.com/shukatsu). The two files beside this one are the only source of its colours and parts. `tokens.css` holds the palette and `ledger.css` holds the shared parts. The app imports both, and the page copies them in at build time, so a change here reaches both surfaces.

## The idea

Shukatsu is a ledger of what the candidate has done, and nothing in it counts until the candidate stamps it. The look follows from that idea. It uses washi paper and sumi ink, structure drawn with 2px ink rules, numbered rows and mono labels. The motif is the hanko (判子): confirming a fact presses the candidate's seal onto it.

## Colour

Paper and ink form a neutral lightness ladder with a 2% warm tint, so the paper reads as washi, never lab white. There is one accent, shu (朱), the vermilion of a hanko's ink pad, and it means one thing everywhere: this needs your stamp. A draft, a waiting decision and a failed check are shu. Anything confirmed is plain ink. Dark mode is sumi paper with the same ladder reversed. Every text pair clears 4.5:1, and the values and their reasons are in `tokens.css`.

## Type

There are three voices, each a stack of an English and a Japanese face, so one class serves both languages.

- **Display:** League Gothic (1900s wood type, one weight, uppercase) over Yuji Syuku (a brush face, one weight). It is used for statements, titles, the 就活 kanji and every seal, so the Japanese reads as calligraphy beside the hanko.
- **Text:** Public Sans over Zen Kaku Gothic New.
- **Labels and figures:** IBM Plex Mono, uppercase with tracking for labels and bold on ink for stamped figures (`.fig`).

Both display faces have a single weight, so nothing asks them for bold. Each surface declares these faces with next/font under the same five variables (`--font-display`, `--font-body`, `--font-mono`, `--font-display-ja`, `--font-body-ja`), so the app's `src/app/layout.tsx` and the page's `site/app/_lib/fonts.ts` must list the same faces.

## Parts

- **Rules.** Structure is drawn with 2px ink rules and 1px hairlines, never with boxes inside boxes, and shadows are not used.
- **Seal pills.** A pill is the one round shape on the page, so it always means "you can press this". Each view has one primary pill, in shu for a decision and in ink for everything else. A pill that records a decision, or is a page's one main action, carries a seal in its left cap: a small hanko at the stamp's angle with one kanji for what it records (確 confirm, 直 correct, 残 keep without figures, 不 unsure, 却 reject, 承 approve, 戻 send back, 検 run the check, 出 submit, 送 sent). The seal gives under the finger like a stamp. Utility pills (cancel, copy, reorder, remove) stay plain.
- **The hanko (`.stamp`).** It is shu while something waits (確認待ち), it is pressed when the candidate confirms (本人確認), and it is dashed for "I don't know" (不明).
- **Figures (`.fig`).** Every number a reviewer vouches for is set like a stamped number, and a changed figure turns shu.

## Space

The app is a ruled grid that runs edge to edge. The product page uses ui-master Design 03, the spacing Mahoraga's and Erwin's pages share, so the product pages on kaitosoeno.com keep one rhythm. That means the 4 to 128px ladder, one gutter (16px, or 32px from 640px wide) and outer gaps at least three times the inner gaps.

## Motion

One curve, `cubic-bezier(0.2, 0.8, 0.2, 1)`, is shared with Mahoraga and Erwin. UI feedback takes 150 to 240ms, and entrances take 640 to 700ms. The only ornament that moves is the hanko, which presses in 260ms when something is confirmed and once on the product page's hero. Under reduced motion nothing animates, and the stamp simply appears.

One exception, decided 2026-10-12: the move in from kaitosoeno.com/portfolio belongs to the site, not to this page. The portfolio row grows into the page and its name rolls into the wordmark on kaitosoeno.com's curve, `cubic-bezier(0.62, 0.04, 0.06, 1)` over 700ms, the same in every product it opens. The page's own entrance after that follows the rules above (`site/app/globals.css`, "Arriving from kaitosoeno.com/portfolio").

## Voice

Copy is plain and specific, and the app's own labels are used word for word on the page ("Confirm", "Correct a figure", "Keep, no figures", "I don't know"). Web copy is one short sentence per idea, with no fragments and no em dashes. Every figure on the product page belongs to a made-up example candidate and is labelled as an example.
