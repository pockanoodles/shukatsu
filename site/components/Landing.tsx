// The product page, both languages. Composition is ui-master Design 03, the
// spacing Mahoraga's and Erwin's pages use: a corner-anchored hero with the
// visual in the middle, then one idea per screen. The parts are the app's own
// (direction "A · Ledger", ../shukatsu/brand): washi and sumi, 2px ink rules,
// numbered ledger rows, mono labels, ink pills, and shu, the hanko's
// vermilion, only where something waits for the candidate's stamp.
import type { Dict, Locale } from "@/content/copy";
import { DIGEST_JA } from "@/content/copy";
import { HOME_URL, PORTFOLIO_URL, PRIVACY_URL, REPO_URL, SETUP_URL } from "@/content/links";
import { AppTour } from "./AppTour";
import { Claim } from "./Claim";
import { EsCounter } from "./EsCounter";
import { ReviewDemo } from "./ReviewDemo";
import { SiteMenu } from "./SiteMenu";

function Eyebrow({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <p className="label eyebrow">
      <span className="eyebrow__n num">{String(n).padStart(2, "0")}</span>
      <span>{children}</span>
    </p>
  );
}

export function Landing({ t, locale }: { t: Dict; locale: Locale }) {
  const self = locale === "en" ? "/shukatsu/" : "/shukatsu/ja/";
  return (
    <>
      <header className="bar">
        <a href={self} className="bar__brand" aria-label={t.nav.label}>
          <span className="stamp bar__mark" aria-hidden>
            就
          </span>
          <span className="bar__word">SHUKATSU</span>
        </a>
        <nav className="bar__nav" aria-label={t.nav.label}>
          <a href="#how">{t.nav.how}</a>
          <a href="#review">{t.nav.review}</a>
          <a href="#app">{t.nav.app}</a>
          <a href="#family">{t.nav.family}</a>
          <a href="#home">{t.nav.home}</a>
        </nav>
        <div className="bar__util">
          <a href={t.lang.href} hrefLang={t.lang.code} lang={t.lang.code} className="label">
            {t.lang.label}
          </a>
          <a href={REPO_URL} className="label">
            {t.nav.github}
          </a>
        </div>
      </header>

      <main>
        <section className="hero" data-hero>
          <div className="hero__visual">
            {/* Set like a hanging scroll: the word in vertical mincho, the
                candidate's seal pressed beside it. */}
            <div className="hero__scroll" aria-hidden>
              <span className="kanji hero__kanji" lang="ja">
                就活
              </span>
              <span className="stamp two hero__seal">
                本人
                <br />
                確認
              </span>
            </div>
            <p className="label hero__caption">{t.hero.caption}</p>
          </div>
          <div className="hero__words">
            <p className="label">{t.hero.label}</p>
            <h1 className="display hero__statement">
              <span>{t.hero.statement[0]}</span> <span className="shu">{t.hero.statement[1]}</span>
            </h1>
            <p className="hero__sub">{t.hero.sub}</p>
          </div>
          <div className="hero__action">
            <a href={SETUP_URL} className="btn btn-lg">
              <span className="seal" aria-hidden>
                宅
              </span>
              {t.hero.cta}
            </a>
            <a href="#how" className="hero__more">
              {t.hero.more} <span aria-hidden>↓</span>
            </a>
          </div>
        </section>

        <section id="how" className="screen">
          <div className="screen__body screen__body--wide">
            <Eyebrow n={1}>{t.how.eyebrow}</Eyebrow>
            <h2 className="display screen__title">{t.how.title}</h2>
            <figure className="ledger" aria-label={t.how.caption}>
              <figcaption className="ledger__head label">
                <span>{t.how.caption}</span>
                <span>{t.how.note}</span>
              </figcaption>
              <div className="ledger__cols label" aria-hidden>
                <span>{t.how.cols.n}</span>
                <span>{t.how.cols.fact}</span>
                <span>{t.how.cols.src}</span>
                <span>{t.how.cols.line}</span>
                <span>{t.how.cols.state}</span>
              </div>
              <ol>
                {t.how.rows.map((row, i) => (
                  <li key={row.id} className="ledger__row">
                    <span className="code ledger__n">{String(i + 1).padStart(2, "0")}</span>
                    <span className="code ledger__id">{row.id}</span>
                    <span className="prov ledger__prov">{row.prov}</span>
                    <span className="ledger__line">
                      <Claim text={row.text} />
                    </span>
                    <span className="ledger__state">
                      {row.waiting ? (
                        <span className="stamp two sm" role="img" aria-label={t.how.stampWaiting.join("")}>
                          {t.how.stampWaiting[0]}
                          <br />
                          {t.how.stampWaiting[1]}
                        </span>
                      ) : (
                        <span className="label">{t.how.confirmed}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            </figure>
            <ol className="steps">
              {t.how.steps.map((step, i) => (
                <li key={step.title} className="step">
                  <span className="code step__n">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="heading step__title">{step.title}</h3>
                  <p className="step__body">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="review" className="screen">
          <div className="screen__body">
            <Eyebrow n={2}>{t.review.eyebrow}</Eyebrow>
            <h2 className="display screen__title">{t.review.title}</h2>
            <p className="screen__sub">{t.review.sub}</p>
            <ReviewDemo t={t.review} />
          </div>
        </section>

        <section id="app" className="screen">
          <div className="screen__body screen__body--wide">
            <Eyebrow n={3}>{t.app.eyebrow}</Eyebrow>
            <h2 className="display screen__title">{t.app.title}</h2>
            <AppTour t={t.app} locale={locale} />
          </div>
        </section>

        <section id="family" className="screen">
          <div className="screen__body screen__body--wide split">
            <div className="split__lead">
              <Eyebrow n={4}>{t.family.eyebrow}</Eyebrow>
              <h2 className="display screen__title">{t.family.title}</h2>
              <p className="lede">{t.family.body}</p>
              <ul className="roles">
                {t.family.roles.map(([role, does]) => (
                  <li key={role}>
                    <span className="heading roles__name">{role}</span>
                    <span>{does}</span>
                  </li>
                ))}
              </ul>
            </div>
            <figure className="digest">
              <figcaption className="digest__head label">
                <span>{t.family.digestCaption}</span>
                <span>{t.family.digestNote}</span>
              </figcaption>
              <pre lang="ja" className="code digest__text">
                {DIGEST_JA}
              </pre>
              <p className="digest__foot">{t.family.digestFoot}</p>
            </figure>
          </div>
        </section>

        <section id="japanese" className="screen">
          <div className="screen__body screen__body--wide split split--flip">
            <div className="split__lead">
              <Eyebrow n={5}>{t.japanese.eyebrow}</Eyebrow>
              <h2 className="display screen__title">{t.japanese.title}</h2>
              <p className="lede">{t.japanese.body}</p>
              <ul className="points">
                {t.japanese.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
            <EsCounter t={t.japanese.es} />
          </div>
        </section>

        <section id="home" className="screen">
          <div className="screen__body screen__body--wide">
            <Eyebrow n={6}>{t.home.eyebrow}</Eyebrow>
            <h2 className="display screen__title">{t.home.title}</h2>
            <p className="screen__sub">{t.home.body}</p>
            <ol className="cells">
              {t.home.points.map((point, i) => (
                <li key={point} className="cell">
                  <span className="code cell__n">{String(i + 1).padStart(2, "0")}</span>
                  <p>{point}</p>
                </li>
              ))}
            </ol>
            <a href={SETUP_URL} className="more">
              {t.home.guide} <span aria-hidden>→</span>
            </a>
          </div>
        </section>

        <section id="open" className="screen screen--end">
          <div className="screen__body">
            <Eyebrow n={7}>{t.open.eyebrow}</Eyebrow>
            <h2 className="display screen__title">{t.open.title}</h2>
            <p className="screen__sub">{t.open.body}</p>
            <div className="end__action">
              <a href={REPO_URL} className="btn btn-lg">
                <span className="seal" aria-hidden>
                  源
                </span>
                {t.open.cta}
              </a>
              <p className="end__note">
                {t.open.by}{" "}
                <a href={PORTFOLIO_URL[locale]}>
                  {t.open.more} <span aria-hidden>→</span>
                </a>
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="foot">
        <div className="foot__brand">
          <span className="stamp foot__mark" aria-hidden>
            就
          </span>
          <span>
            {t.footer.rights} · {t.footer.license}
          </span>
        </div>
        <div className="foot__cols">
          <div>
            <p className="label">{t.footer.product}</p>
            <ul>
              <li>
                <a href={SETUP_URL}>{t.footer.setup}</a>
              </li>
              <li>
                <a href={REPO_URL}>{t.footer.source}</a>
              </li>
              <li>
                <a href={PRIVACY_URL[locale]}>{t.footer.privacy}</a>
              </li>
            </ul>
          </div>
          <div>
            <p className="label">{t.footer.maker}</p>
            <ul>
              <li>
                <a href={PORTFOLIO_URL[locale]}>{t.footer.portfolio}</a>
              </li>
              <li>
                <a href={HOME_URL[locale]}>{t.menu.items[0].label}</a>
              </li>
            </ul>
          </div>
        </div>
      </footer>

      <SiteMenu t={t.menu} />
    </>
  );
}
