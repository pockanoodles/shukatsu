import type { MetadataRoute } from "next";
import { SITE } from "./_lib/meta";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE}/shukatsu/`, alternates: { languages: { ja: `${SITE}/shukatsu/ja/` } } },
    { url: `${SITE}/shukatsu/ja/`, alternates: { languages: { en: `${SITE}/shukatsu/` } } },
  ];
}
