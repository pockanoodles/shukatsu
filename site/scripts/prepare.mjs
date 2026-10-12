// Brings the app's look into the page before each build. The palette and the
// Ledger parts live with the app (../shukatsu/brand), and the favicon is the
// app's own, so the page can never show a colour, a button or a mark the app
// doesn't have. The copies are gitignored.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = join(site, "..", "shukatsu");

mkdirSync(join(site, "generated"), { recursive: true });
for (const f of ["tokens.css", "ledger.css"]) copyFileSync(join(app, "brand", f), join(site, "generated", f));
copyFileSync(join(app, "src", "app", "icon.svg"), join(site, "public", "favicon.svg"));
