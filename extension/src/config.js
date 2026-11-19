// Where the extension talks to. The app is chat.morningtelos.com and its Supabase sign-in is db.morningtelos.com.
// A build made with `npm run build -- --dev` also allows the app on localhost:3000 (scripts/build.mjs).

export const APP = "https://chat.morningtelos.com";
export const DB = "https://db.morningtelos.com";
export const DEV_APP = "http://localhost:3000";
export const DEV_DB = "http://localhost:54321";

/** The page in the app where a person connects this browser (web/src/components/Extension.tsx). */
export const CONNECT_PATH = "/settings/extension";
export const PRIVACY_URL = "https://morningtelos.com/privacy/#chrome-extension";

/** The same limits as the server (web/src/lib/pageContext.ts). */
export const LIMITS = { text: 20000, selection: 5000, title: 300 };
/** Most base64 characters of a screenshot the server takes. */
export const SHOT_MAX = 900000;
/** Minutes between approval count checks while signed in. */
export const POLL_MINUTES = 1;

/** The app and Supabase addresses this build may use, read from the manifest's host permissions. */
export function origins(manifest) {
  const hosts = manifest?.host_permissions ?? [];
  const has = (o) => hosts.includes(`${o}/*`);
  return { apps: [APP, DEV_APP].filter(has), dbs: [DB, DEV_DB].filter(has) };
}
