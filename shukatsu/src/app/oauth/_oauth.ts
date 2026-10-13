import "server-only";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ENGINE_DIR } from "@/lib/server/engine";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The authorization server's engine module, loaded at runtime by Node (never
 * bundled), the same way engine.ts loads the rest. The daemon imports the same
 * file, so both see one module and one set of database handles.
 */
export const loadOAuth = (): Promise<any> => import(/* turbopackIgnore: true */ /* webpackIgnore: true */ pathToFileURL(join(ENGINE_DIR, "shukatsu/core/oauth.mjs")).href);
