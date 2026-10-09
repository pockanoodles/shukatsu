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

1. Pick the archetype from the JD and read its row in `_profile.md`'s framing table.
2. Draft the bullets from `article-digest.md` and `cv.md` under rules 1–13.
3. Write them into the CV payload, then run:
   - `node shukatsu/bullet-lint.mjs <generated.md|html>` (zero errors)
   - `node verify-cv-facts.mjs <generated>` (every number is in the sources)
   - `node shukatsu/audit-materials.mjs <generated>` (no forbidden claims, required lines present)
   Fix and rerun until all three pass. Don't show a draft that fails.
4. Show the candidate the bullets that changed from `cv.md`, each next to its
   original, with the reason for the change.
5. **Learn from his rewrites.** When he edits a generated bullet, diff his version
   against yours and append an entry to `edit_log` in `config/bullet-rules.yml`
   (date, before, after, pattern). When a pattern shows up twice, propose it as a rule:
   a config value if the linter can check it, a line in this file if it can't.
   If his edit improves the canonical wording, offer to update `cv.md` too.
