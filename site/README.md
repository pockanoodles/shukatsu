# Shukatsu's product page

The page at [kaitosoeno.com/shukatsu](https://kaitosoeno.com/shukatsu/), in English and Japanese. It is a static Next.js export served by its own Cloudflare Worker on the `kaitosoeno.com/shukatsu*` route, so it ships on Shukatsu's schedule while the personal site stays the origin for every other path. Erwin's and Mahoraga's pages are built the same way.

```sh
npm install
npm run dev        # http://localhost:3140/shukatsu/
npm run preview    # build, then serve dist/ through the Worker at http://localhost:3240/shukatsu/
npm run verify     # Playwright sweep of both languages on a laptop and a phone (set BASE to target another host)
npm run shots      # retake the app screenshots in public/shots (see below)
npx wrangler deploy
```

- **The look comes from the app.** `scripts/prepare.mjs` copies the palette and the Ledger parts from `../shukatsu/brand` (see `BRAND.md` there) and the app's favicon before every build, so the page can't drift from the app. The fonts in `app/_lib/fonts.ts` must match the app's `src/app/layout.tsx`.
- **Copy** lives in `content/copy.ts`, both languages behind one type, so a missing translation fails the build. Every claim describes what the app does today, and every figure belongs to a made-up example candidate.
- **Screenshots** are the real app running on the repo's test fixture (`shukatsu/tests/fixtures`), never a real record. `npm run shots` builds the app, seeds a throwaway copy of the fixture, signs in and captures each screen in both languages and both themes. The real data root is never read.
- **From the portfolio** the page is entered through a cross-document view transition. `components/ViewTransition.tsx` and the "Arriving from kaitosoeno.com/portfolio" block in `app/globals.css` are this page's half of a contract with personal-website, and `components/SiteMenu.tsx` is a copy of the site's menu pill. Erwin's and Mahoraga's pages hold the same copies, so change all of them together.
