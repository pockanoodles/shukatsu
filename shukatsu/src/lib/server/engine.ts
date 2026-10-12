import "server-only";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The app's one door into the engine.
 *
 * The engine (shukatsu/core, and the upstream career-ops modules it builds on)
 * is loaded at runtime by Node itself, never bundled: upstream modules find
 * their own files through import.meta.url, which a bundler rewrites. Loaded
 * this way, the app runs exactly the code the CLI runs, from the same files.
 *
 * SHUKATSU_ENGINE overrides where the checkout is (default: the parent of the
 * app's working directory, since the app runs from shukatsu/).
 *
 * The engine is plain JS, so its modules are typed loosely here; the shapes
 * pages rely on are declared in @/lib/types. Changing engine code needs a
 * server restart (Node caches loaded modules).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export const ENGINE_DIR = process.env.SHUKATSU_ENGINE ? resolve(process.env.SHUKATSU_ENGINE) : resolve(process.cwd(), "..");

const load = (rel: string): Promise<any> => import(/* turbopackIgnore: true */ /* webpackIgnore: true */ pathToFileURL(join(ENGINE_DIR, rel)).href);

const CORE = ["review", "proposals", "people", "packets", "passkeys", "tracker", "store", "facts", "manifests", "digest", "llm", "git", "validate", "profile-edit", "candidate"] as const;

export type Engine = {
  root: string;
  review: any; proposals: any; people: any; packets: any; passkeys: any; tracker: any; store: any; facts: any;
  manifests: any; digest: any; llm: any; gitlog: any; validate: any; profileEdit: any; candidate: any;
};

let loading: Promise<Engine> | null = null;

async function boot(): Promise<Engine> {
  if (!existsSync(join(ENGINE_DIR, "shukatsu", "core", "review.mjs"))) {
    throw new Error(`No shukatsu engine at ${ENGINE_DIR}. Run the app from shukatsu/, or set SHUKATSU_ENGINE to the career-ops checkout.`);
  }
  const [resolver, ...mods] = await Promise.all([load("path-resolver.mjs"), ...CORE.map((m) => load(`shukatsu/core/${m}.mjs`))]);
  const by = Object.fromEntries(CORE.map((m, i) => [m, mods[i]]));
  const root: string = resolver.getCareerOpsRoot();
  if (!existsSync(join(root, "data", "career-profile.yml"))) {
    throw new Error(`No master profile under ${root}. Point .career-ops-data or CAREER_OPS_DATA_DIR at the data root.`);
  }
  return {
    root, review: by.review, proposals: by.proposals, people: by.people, packets: by.packets, passkeys: by.passkeys,
    tracker: by.tracker, store: by.store, facts: by.facts, manifests: by.manifests, digest: by.digest, llm: by.llm,
    gitlog: by.git, validate: by.validate, profileEdit: by["profile-edit"], candidate: by.candidate,
  };
}

/** The engine, loaded once per server process. */
export function engine(): Promise<Engine> {
  loading ??= boot().catch((e) => { loading = null; throw e; });
  return loading;
}
