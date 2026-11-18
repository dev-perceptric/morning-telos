// The one-click unsubscribe link in emails people can turn off (the weekly digest and tips). Pure: the route
// (src/app/api/email/unsubscribe/route.ts) passes the keyring and how to save.
//
// The link carries a sealed token (src/lib/sealing.ts) with the workspace and the person, so nobody can make one
// for someone else, and no sign-in is needed. Opening the link shows one button, so a mail scanner that opens every
// link never turns emails off by itself. Mail apps that offer their own Unsubscribe button POST to the same address
// (List-Unsubscribe-Post, RFC 8058), which turns them off right away.

import { esc } from "./emailKit.ts";
import { openWith, sealWith, type Keyring } from "./sealing.ts";

const AAD = "email-unsubscribe";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Unsubscriber = { workspaceId: string; userId: string };

/** A token for this person in this workspace. */
export function unsubscribeToken(ring: Keyring, u: Unsubscriber): string {
  return sealWith(ring, JSON.stringify({ w: u.workspaceId, u: u.userId }), AAD);
}

/** Who a token is for, or null when it's broken, changed or made with a key that's gone. */
export function readUnsubscribeToken(ring: Keyring, token: string | null | undefined): Unsubscriber | null {
  if (!token || token.length > 1000) return null;
  try {
    const v = JSON.parse(openWith(ring, token, AAD)) as { w?: unknown; u?: unknown };
    if (typeof v.w !== "string" || typeof v.u !== "string" || !UUID.test(v.w) || !UUID.test(v.u)) return null;
    return { workspaceId: v.w, userId: v.u };
  } catch {
    return null;
  }
}

/** The link that goes in the email. */
export const unsubscribeUrl = (appUrl: string, token: string) => `${appUrl.replace(/\/+$/, "")}/api/email/unsubscribe?t=${encodeURIComponent(token)}`;

/** The headers that let mail apps show their own one-click Unsubscribe button. */
export const unsubscribeHeaders = (url: string): Record<string, string> => ({ "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });

export type UnsubscribeDeps = {
  /** Null when SEALING_KEYS isn't set: every link fails. */
  ring: Keyring | null;
  /** Turn the weekly digest and tips off for this person in this workspace. */
  save: (u: Unsubscriber) => Promise<void>;
  appUrl: string;
};

export type UnsubscribeResult = { status: number; html: string };

function page(title: string, lines: string[], extra = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title></head>
<body style="margin:0;background:#faf9f5;color:#141413;font-family:Helvetica,Arial,sans-serif">
<main style="max-width:480px;margin:0 auto;padding:56px 24px">
<p style="font-size:15px;font-weight:600;margin:0 0 28px">Morning Telos</p>
<h1 style="font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:28px;line-height:34px;margin:0 0 14px">${esc(title)}</h1>
${lines.map((l) => `<p style="font-size:16px;line-height:25px;color:#3a3a37;margin:0 0 14px">${esc(l)}</p>`).join("\n")}
${extra}
</main></body></html>`;
}

const button = (label: string) =>
  `<button type="submit" style="background:#141413;color:#fff;border:0;border-radius:10px;padding:12px 20px;font-size:15px;font-weight:600;cursor:pointer">${esc(label)}</button>`;
const settingsLink = (appUrl: string) => `<p style="font-size:14px;margin:18px 0 0"><a href="${esc(appUrl)}/settings" style="color:#65645f">Open Settings</a></p>`;

/** GET shows the button. POST (the button, or a mail app) turns the emails off. */
export async function handleUnsubscribe(req: { method: string; token: string | null }, d: UnsubscribeDeps): Promise<UnsubscribeResult> {
  const who = d.ring ? readUnsubscribeToken(d.ring, req.token) : null;
  if (!who) return { status: 400, html: page("This link didn't work", ["It may be old or cut off. You can turn off emails in Settings instead."], settingsLink(d.appUrl)) };
  if (req.method !== "POST") {
    const action = `?t=${encodeURIComponent(req.token ?? "")}`;
    return {
      status: 200,
      html: page("Turn off the weekly digest?", ["You will stop getting the weekly digest and tips for this workspace. Trial and billing emails still go to the owner."], `<form method="post" action="${esc(action)}">${button("Turn them off")}</form>`),
    };
  }
  try {
    await d.save(who);
  } catch {
    return { status: 500, html: page("That didn't work", ["We couldn't save your choice. Try again in a minute."]) };
  }
  return { status: 200, html: page("You're unsubscribed", ["You won't get the weekly digest or tips anymore. You can turn them back on in Settings."], settingsLink(d.appUrl)) };
}
