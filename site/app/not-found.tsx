import { fontVars } from "./_lib/fonts";
import "./globals.css";

// Exported as 404.html; the Worker serves it for any unknown /shukatsu path.
export default function NotFound() {
  return (
    <html lang="en" className={fontVars}>
      <body>
        <main className="lost">
          <span className="stamp dashed lost__stamp" aria-hidden>
            不明
          </span>
          <p className="label">404</p>
          <h1 className="display lost__title">This page does not exist.</h1>
          <a href="/shukatsu/" className="btn btn-lg">
            Back to Shukatsu
          </a>
        </main>
      </body>
    </html>
  );
}
