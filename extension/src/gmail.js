// Gmail (mail.google.com). The side panel looks for an open compose or reply box (hasReplyBox), reads the open email
// when the person clicks "Draft a reply" (readEmail), and puts the teammate's draft into the box when they click
// "Put in reply box" (insertReply). These run in the Gmail tab through chrome.scripting.executeScript, so each one
// keeps its helpers inside itself. Nothing here ever clicks Send or anything else: the person sends it themselves.

/** Gmail's message boxes: a new email, a reply and a forward. */
export const BOX = 'div[aria-label="Message Body"][contenteditable="true"], div[role="textbox"][g_editable="true"]';

/** True when a compose or reply box is open. Reads nothing else. */
export function hasReplyBox(doc = document) {
  return Boolean(doc.querySelector('div[aria-label="Message Body"][contenteditable="true"], div[role="textbox"][g_editable="true"]'));
}

/**
 * The open email thread as text: the subject, then each message with who wrote it, oldest first. With no thread open
 * (a new email), the draft's To and Subject. `limits` is { text, title }.
 */
export function readEmail(limits, doc = document, loc = location) {
  const clean = (raw) =>
    String(raw ?? "")
      .replace(/\r\n?/g, "\n")
      .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, "")
      .replace(/[^\S\n]+/g, " ")
      .split("\n")
      .map((l) => l.trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  const words = (el) => (el ? String(el.innerText ?? el.textContent ?? "") : "");
  const scope = doc.querySelector('div[role="main"]') || doc;
  const subject = clean(words(scope.querySelector("h2.hP"))).replace(/\s+/g, " ");
  const parts = [];
  for (const m of scope.querySelectorAll("div.adn")) {
    const from = m.querySelector(".gD");
    const who = from ? `${clean(from.getAttribute("name") || words(from))} <${clean(from.getAttribute("email"))}>` : "Someone";
    const body = clean(words(m.querySelector(".a3s")));
    if (body) parts.push(`From: ${who}\n${body}`);
  }
  if (!parts.length) {
    const box = doc.querySelector('div[aria-label="Message Body"][contenteditable="true"], div[role="textbox"][g_editable="true"]');
    const form = box ? box.closest('div[role="dialog"], form, .M9, .iN') || doc : doc;
    const to = form.querySelector("[email]")?.getAttribute("email") || "";
    const subj = form.querySelector('input[name="subjectbox"]')?.value || "";
    parts.push(`A new email${to ? ` to ${to}` : ""}${subj ? ` about "${subj}"` : ""}. There is no earlier message.`);
  }
  // The newest messages matter most: keep the end when the thread is long.
  let text = parts.join("\n\n---\n\n");
  if (text.length > limits.text) text = text.slice(text.length - limits.text);
  return { url: String(loc.href), title: (subject || "Email in Gmail").slice(0, limits.title), text, selection: "" };
}

/**
 * Puts `text` into the reply box the person used last (or the only one open), at the cursor, the way typing would.
 * Copied from Omniscient's insertText (extension/panel.js). Returns { ok } or { ok: false, error }. Never sends.
 */
export function insertReply(text, doc = document) {
  const sel = 'div[aria-label="Message Body"][contenteditable="true"], div[role="textbox"][g_editable="true"]';
  const active = doc.activeElement && typeof doc.activeElement.closest === "function" ? doc.activeElement.closest(sel) : null;
  const all = [...doc.querySelectorAll(sel)];
  const box = active || all[all.length - 1] || null;
  if (!box) return { ok: false, error: "Open a reply box in Gmail first." };
  box.focus();
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  let typed = true;
  lines.forEach((line, i) => {
    if (i > 0) typed = doc.execCommand("insertLineBreak") && typed;
    if (line) typed = doc.execCommand("insertText", false, line) && typed;
  });
  if (!typed) {
    // Gmail turned typing off: add the lines as text at the top of the box instead.
    const first = box.firstChild;
    lines.forEach((line) => {
      const div = doc.createElement("div");
      div.textContent = line;
      box.insertBefore(div, first);
    });
  }
  box.dispatchEvent(new InputEvent("input", { bubbles: true }));
  return { ok: true };
}

const SALES = /\b(quote|quotes|pricing|price|prices|cost|costs|estimate|proposal|buy|purchase|discount|demo|interested|availability|book a call|hire|rates?)\b/i;

/**
 * Who drafts the reply: whoever the person tagged, else Midas for sales mail (prices, quotes, buying) and Irene for
 * everything else (questions, problems, support). Returns the teammate's name.
 */
export function pickReplyAgent(email, typed = "") {
  const tag = /(?:^|[^\w@])@(Alexander|Midas|Irene|Cleo|Cyrus|Leo|Theseus|Archon)\b/i.exec(String(typed));
  if (tag) return tag[1][0].toUpperCase() + tag[1].slice(1).toLowerCase();
  return SALES.test(`${email?.title ?? ""}\n${email?.text ?? ""}`) ? "Midas" : "Irene";
}
