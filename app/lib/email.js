// Account emails through Resend.
const FROM = process.env.EMAIL_FROM || "Morning Telos <meet@morningtelos.com>";
const API = process.env.RESEND_API_URL || "https://api.resend.com";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function layout({ title, intro, button, url, outro }) {
  return `<!doctype html><html><body style="margin:0;background:#faf9f5;font-family:Helvetica,Arial,sans-serif;color:#141413">
<div style="max-width:520px;margin:0 auto;padding:36px 24px">
  <div style="font-size:15px;font-weight:600;margin-bottom:28px">Morning Telos</div>
  <h1 style="font-family:Georgia,serif;font-weight:400;font-size:28px;line-height:1.2;margin:0 0 14px">${esc(title)}</h1>
  <p style="font-size:16px;line-height:1.55;color:#3a3a37;margin:0 0 22px">${esc(intro)}</p>
  ${button ? `<a href="${esc(url)}" style="display:inline-block;background:#141413;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:10px">${esc(button)}</a>` : ""}
  ${outro ? `<p style="font-size:14px;line-height:1.55;color:#65645f;margin:22px 0 0">${esc(outro)}</p>` : ""}
  ${url ? `<p style="font-size:12px;color:#8c8b84;margin:28px 0 0;word-break:break-all">Or paste this link: ${esc(url)}</p>` : ""}
</div></body></html>`;
}

export async function sendEmail({ to, subject, html, text }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.warn("email skipped (no RESEND_API_KEY):", subject); return false; }
  try {
    const r = await fetch(`${API}/emails`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: Array.isArray(to) ? to : [to], subject, html, text }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) { console.error("email failed", r.status, (await r.text()).slice(0, 200)); return false; }
    return true;
  } catch (e) { console.error("email error", e.message); return false; }
}
