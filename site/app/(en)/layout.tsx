import { fontVars } from "../_lib/fonts";
import { metadataFor, viewport } from "../_lib/meta";
import { ViewTransitionScript, ViewTransitionSurface } from "@/components/ViewTransition";
import "../globals.css";

export const metadata = metadataFor("en");
export { viewport };

export default function EnLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={fontVars}>
      <head>
        <ViewTransitionScript />
      </head>
      <body>
        <ViewTransitionSurface />
        {children}
      </body>
    </html>
  );
}
