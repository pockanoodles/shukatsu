# Mode: bullets -- write and tailor resume bullets

<!-- System layer, owned by the shukatsu fork. Applies whenever a CV is generated or
     tailored (modes/pdf.md, modes/latex.md, modes/text.md, auto-pipeline), and when
     the candidate asks to rewrite bullets. Read after modes/_shared.md and the user
     layer. The checkable rules are enforced by shukatsu/bullet-lint.mjs; this file
     holds the full rule set, including the ones only judgment can apply. -->

## The rules

**Checked by `bullet-lint.mjs`** (rules are configurable in `{DATA_ROOT}/config/bullet-rules.yml`):
1. **Strong verb first, in the right tense.** Past tense for ended roles. No duty
   openers (Responsible for, Helped, Worked on, Assisted, Used, Leveraged).
2. **Two lines at most** (`max_chars`, 230 by default for US letter at 10pt).
3. **A number for scope or result** in nearly every bullet.
4. **No filler or AI vocabulary** (humanize's core list plus resume cliches like
   spearheaded, results-driven, successfully, innovative).
5. **No pronouns, no hedges** ("helped to", "involved in").
6. **The candidate's punctuation rules**: for this candidate no em dashes, no
   semicolons, straight quotes, and consistent end periods.
7. **No repeated openers** within a role, and no verb opening more than 2 bullets.

**Applied by you, before the linter runs:**
8. **Action → what → what it meant.** Every number sits next to its meaning in the
   same bullet: a baseline ("from 30 to 350"), a comparison ("32.5% vs 3.7%"), or a
   denominator ("69 of 314"). A bare "improved X by 40%" with no anchor isn't allowed.
9. **One idea per bullet.** If a bullet needs "and" to join two results, split it or
   drop the weaker one.
10. **Numbers are verbatim.** Copy each figure exactly as `article-digest.md` states it
    (the digest wins over `cv.md`). Rewrite the framing around a number, never the
    number itself. Only [V]/[M] figures, plus [U] figures exactly as the candidate
    already states them.
11. **The reader's vocabulary.** Mirror the JD's terms (their tool names, their title
    for the function) only where `cv.md` or the digest supports the claim. Reword
    freely, but never invent anything.
12. **Order by relevance.** Within a role, the bullet that best matches the JD goes
    first. Cap the main role at 4–5 bullets and minor roles at 2. Use the adaptive
    framing table in `modes/_profile.md` to pick which proof points lead.
13. **No overclaim verbs.** Shipped, deployed, launched, and productionized appear only
    where the digest's Overclaim Guards allow them.

## Protocol

When `{DATA_ROOT}/data/career-profile.yml` exists, every resume is a selection from it
(`shukatsu/master.mjs`). Without one, fall back to drafting from `cv.md` and the digest
and run the three gates by hand.

1. Pick the archetype from the JD and read its row in `_profile.md`'s framing table.
2. `node shukatsu/master.mjs select --archetype <id> --company <C> --role <R> --jd jds/<slug>.md`.
   It scores each verified fact by the archetype's tags, the JD's words, and its
   priority, keeps the one-page budget (rule 12), picks archetype variants, and writes
   a draft to `output/tailored/` plus a manifest to `data/manifests/`. Read the
   "left out" list: a fact the JD clearly wants can be swapped in by hand.
3. Reword toward the JD under rules 1–13. Move the framing, never the numbers, and
   never add a claim. A claim the master doesn't hold goes into the profile as a
   `needs_review` fact for the candidate to confirm first.
4. `node shukatsu/master.mjs finalize <manifest>`. It traces every bullet back to a
   verified fact, fails on any changed number or untraceable line, then runs
   `bullet-lint`, `verify-cv-facts`, and `audit-materials`. Fix and rerun until it says
   Final. Don't show a draft that fails.
5. Show the candidate the bullets that changed from `cv.md`, each next to its
   original, with the reason for the change.
6. Build the PDF payload from the final draft (`modes/pdf.md`). After he submits:
   `master.mjs sent <manifest> --on YYYY-MM-DD --num <tracker #>`.
7. **Learn from his rewrites.** When he edits a generated bullet, diff his version
   against yours and append an entry to `edit_log` in `config/bullet-rules.yml`
   (date, before, after, pattern). When a pattern shows up twice, propose it as a rule:
   a config value if the linter can check it, a line in this file if it can't.
   If his edit improves the canonical wording, offer to make it the fact's text (or a
   variant) in the master profile, then re-render `cv.md`.
