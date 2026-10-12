import type { Metadata, Viewport } from "next";
import { copy, type Locale } from "@/content/copy";

export const SITE = "https://kaitosoeno.com";

const PATHS: Record<Locale, string> = { en: "/shukatsu/", ja: "/shukatsu/ja/" };

export function metadataFor(locale: Locale): Metadata {
  const t = copy[locale].meta;
  return {
    metadataBase: new URL(SITE),
    title: t.title,
    description: t.description,
    alternates: { canonical: PATHS[locale], languages: { en: PATHS.en, ja: PATHS.ja, "x-default": PATHS.en } },
    icons: { icon: "/shukatsu/favicon.svg", apple: "/shukatsu/apple-touch-icon.png" },
    openGraph: {
      type: "website",
      url: PATHS[locale],
      title: t.title,
      description: t.description,
      siteName: "Shukatsu",
      locale: locale === "ja" ? "ja_JP" : "en_US",
      images: [{ url: "/shukatsu/og.png", width: 1200, height: 630, alt: t.title }],
    },
    twitter: { card: "summary_large_image", title: t.title, description: t.description, images: ["/shukatsu/og.png"] },
  };
}

// Washi by day and sumi by night, as the app does: the page follows the
// visitor's system theme, and the tokens (generated/tokens.css) switch with it.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f3ee" },
    { media: "(prefers-color-scheme: dark)", color: "#151413" },
  ],
  colorScheme: "light dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};
