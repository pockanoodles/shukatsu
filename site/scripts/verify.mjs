// A Playwright sweep of the built page: both languages, a laptop and a phone.
// It loads the page the way a visitor does and drives the parts that move, so
// a broken interaction fails here rather than on kaitosoeno.com.
//
//   npm run preview   (builds, then serves dist/ on :3240 through the Worker)
//   BASE=http://localhost:3240 npm run verify
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3240";
const PAGES = [
  {
    path: "/shukatsu/", lang: "en", h1: "Every resume, traced to a fact.", tabs: ["Today", "Review", "Record", "Packet"],
    confirm: "Confirm", correct: "Correct a figure", narrative: "Keep, no figures", unsure: "I don't know", submitEdit: "Confirm this wording", reopen: "Put back in the queue", menu: /menu/i,
  },
  {
    path: "/shukatsu/ja/", lang: "ja", h1: "すべての書類を、 事実にひもづける。", tabs: ["今日", "レビュー", "記録", "応募書類"],
    confirm: "確認する", correct: "数字を直す", narrative: "数字なしで残す", unsure: "わからない", submitEdit: "この表現で確認", reopen: "キューに戻す", menu: /メニュー/,
  },
];
const VIEWPORTS = [
  { name: "laptop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
];

const failures = [];
const check = (ok, what) => {
  if (!ok) failures.push(what);
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
};

const browser = await chromium.launch();
for (const pg of PAGES) {
  for (const vp of VIEWPORTS) {
    const tag = `${pg.lang}/${vp.name}`;
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
    const res = await page.goto(BASE + pg.path, { waitUntil: "networkidle" });
    check(res?.status() === 200, `${tag}: page answers 200`);
    check((await page.getAttribute("html", "lang")) === pg.lang, `${tag}: <html lang="${pg.lang}">`);
    check((await page.textContent("h1"))?.replace(/\s+/g, " ").trim() === pg.h1, `${tag}: the statement is the h1`);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflow <= 0, `${tag}: no sideways scroll (${overflow}px)`);

    // The ledger marks every figure, and the waiting row carries the hanko.
    check((await page.locator(".ledger__row").count()) === 3, `${tag}: the ledger shows three rows`);
    check((await page.locator(".ledger .fig").count()) >= 8, `${tag}: the ledger marks its figures`);
    check((await page.locator(".ledger__state .stamp").count()) === 1, `${tag}: one row waits for the stamp`);

    // Review: each answer decides the item, presses the right stamp, and resets.
    const review = page.locator(".review");
    const decide = async (name) => review.getByRole("button", { name, exact: false }).first().click();
    const reopen = async () => review.getByRole("button", { name: pg.reopen }).click();
    await decide(pg.confirm);
    check((await review.getAttribute("data-decided")) === "accept" && (await review.locator(".stamp.press").count()) === 1, `${tag}: Confirm stamps the item`);
    await reopen();
    check((await review.getAttribute("data-decided")) === null && (await review.locator(".review__figs").count()) === 1, `${tag}: it goes back in the queue`);
    await decide(pg.correct);
    const field = review.locator("textarea");
    check(await field.isVisible(), `${tag}: Correct a figure opens the wording`);
    await field.fill((await field.inputValue()).replace("14", "12"));
    await review.getByRole("button", { name: pg.submitEdit }).click();
    check((await review.locator(".fig.changed").textContent()) === "12", `${tag}: the corrected figure is marked as changed`);
    await reopen();
    await decide(pg.narrative);
    await review.locator("form button[type=submit]").click();
    check((await review.getAttribute("data-decided")) === "narrative" && (await review.locator(".review__claim .fig").count()) === 0, `${tag}: Keep, no figures drops the figures`);
    await reopen();
    await decide(pg.unsure);
    check((await review.locator(".stamp.dashed").count()) === 1, `${tag}: I don't know leaves the dashed stamp`);
    await reopen();
    // The app's keys work while focus is inside the item.
    await review.getByRole("button", { name: pg.unsure }).focus();
    await page.keyboard.press("a");
    check((await review.getAttribute("data-decided")) === "accept", `${tag}: the A key confirms`);
    await reopen();

    // The entry-sheet counter counts, and turns shu under the 80% norm.
    const meter = page.locator(".es__meter");
    check((await meter.getAttribute("data-state")) === "ok", `${tag}: the example answer is within the norm`);
    const es = page.locator("#es-answer");
    const answer = await es.inputValue();
    await es.fill(answer.slice(0, 100));
    check((await meter.getAttribute("data-state")) === "under" && (await page.locator(".es__count").textContent())?.includes("100"), `${tag}: a short answer counts 100 and falls under the norm`);
    await es.fill(answer + answer);
    check((await meter.getAttribute("data-state")) === "over", `${tag}: a long answer goes over the limit`);
    await es.fill(answer);

    // The tour shows exactly one screenshot, the tabs switch it, and each one
    // loads once it is shown (they are lazy, so a hidden one never loads).
    for (const label of pg.tabs) {
      await page.getByRole("tab", { name: label, exact: true }).click();
      const shown = page.locator(".tour__shot picture:not([hidden]) img");
      const selected = await page.getByRole("tab", { name: label, exact: true }).getAttribute("aria-selected");
      check((await shown.count()) === 1 && selected === "true", `${tag}: tab "${label}" shows one screenshot`);
      await shown.scrollIntoViewIfNeeded();
      const loaded = await shown.evaluate((img) => img.decode().then(() => img.naturalWidth > 0, () => false));
      check(loaded, `${tag}: the "${label}" screenshot loads`);
    }
    await page.getByRole("tab", { name: pg.tabs.at(-1), exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    check((await page.getByRole("tab", { name: pg.tabs[0], exact: true }).getAttribute("aria-selected")) === "true", `${tag}: arrow keys move between tabs`);

    // The site's MENU pill opens on one line, and closes.
    const label = page.locator(".site-menu__label");
    check((await label.evaluate((el) => el.getBoundingClientRect().height)) < 30, `${tag}: the menu label sits on one line`);
    await page.getByRole("button", { name: pg.menu }).click();
    await page.waitForTimeout(450);
    check(await page.locator("#site-menu").isVisible(), `${tag}: the site menu opens`);
    check((await page.locator('#site-menu a[href$="portfolio"]').count()) === 1, `${tag}: the menu links back to the portfolio`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(450);
    check(!(await page.locator("#site-menu").isVisible()), `${tag}: Escape closes it`);

    check(errors.length === 0, `${tag}: no console errors or failed requests${errors.length ? ` (${errors.slice(0, 3).join(" | ")})` : ""}`);
    await page.close();
  }
}

// Any other path under /shukatsu is the page's own 404.
const lost = await browser.newPage();
const res = await lost.goto(BASE + "/shukatsu/nowhere/", { waitUntil: "load" });
check(res?.status() === 404 && (await lost.locator(".lost").count()) === 1, "an unknown path gets the 404 page");
await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
