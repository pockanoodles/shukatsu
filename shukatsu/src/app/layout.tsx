import type { Metadata, Viewport } from "next";
import { Anton, IBM_Plex_Mono, IBM_Plex_Sans, Shippori_Mincho, Zen_Kaku_Gothic_New } from "next/font/google";
import { headers } from "next/headers";
import { getLang } from "@/lib/server/session";
import { translator } from "@/lib/i18n";
import "./globals.css";

// next/font downloads these at build time and serves them from this server, so
// a page view never calls Google.
//
// Two type systems, one stack each: English in Poster Condensed (Anton, IBM Plex),
// Japanese in Serif Twist (Shippori Mincho for display, Zen Kaku Gothic New for
// text). Anton and Plex carry no kana or kanji, so every Japanese character falls
// through to its Japanese face on its own, mid-line included. Shippori is loaded
// at 800 only, so Japanese display stays heavy wherever Anton (one weight) sits.
const display = Anton({ variable: "--font-display", weight: "400", subsets: ["latin"] });
const body = IBM_Plex_Sans({ variable: "--font-body", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const mono = IBM_Plex_Mono({ variable: "--font-mono", subsets: ["latin"], weight: ["400", "500", "700"] });
const displayJa = Shippori_Mincho({ variable: "--font-display-ja", weight: "800", subsets: ["latin"], preload: false });
const bodyJa = Zen_Kaku_Gothic_New({ variable: "--font-body-ja", weight: ["400", "500", "700"], subsets: ["latin"], preload: false });

export async function generateMetadata(): Promise<Metadata> {
  const { t } = translator(await getLang());
  return { title: { default: t("meta.title"), template: `%s · ${t("meta.title")}` }, description: t("meta.description"), robots: { index: false, follow: false } };
}

export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f6f3ee" }, { media: "(prefers-color-scheme: dark)", color: "#151413" }],
};

// Runs before first paint so a saved theme never flashes.
const themeScript = `try{var t=localStorage.getItem("shk-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang={lang} suppressHydrationWarning className={`${display.variable} ${body.variable} ${mono.variable} ${displayJa.variable} ${bodyJa.variable} h-full`}>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
