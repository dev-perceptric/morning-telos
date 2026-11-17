// Emails the Morning Telos team when something keeps failing. Each kind of alert is sent at most once an hour.
import { all } from "./db.js";
import { sendEmail, layout } from "./email.js";

const lastSent = new Map();
const recent = new Map(); // kind -> [timestamps]

export async function alert(kind, subject, detail) {
  const now = Date.now();
  if (now - (lastSent.get(kind) || 0) < 60 * 60 * 1000) return;
  lastSent.set(kind, now);
  const admins = (await all("select email from users where is_admin").catch(() => [])).map((r) => r.email);
  const to = [...new Set([process.env.ALERT_EMAIL || "meet@morningtelos.com", ...admins])];
  console.error("ALERT", kind, subject, detail);
  await sendEmail({ to, subject: `[Morning Telos alert] ${subject}`, text: `${subject}\n\n${detail}`,
    html: layout({ title: subject, intro: detail, button: "Open Admin", url: "https://chat.morningtelos.com/#admin", outro: "You'll get at most one email like this per hour." }) });
}

// Counts failures; alerts when `max` happen within `windowMs`.
export function noteFailure(kind, subject, detail, max = 3, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const list = (recent.get(kind) || []).filter((t) => now - t < windowMs);
  list.push(now);
  recent.set(kind, list);
  if (list.length >= max) alert(kind, subject, `${detail}\n\n${list.length} times in the last ${Math.round(windowMs / 60000)} minutes.`).catch(() => {});
}
