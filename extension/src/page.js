// Reading the open tab, only when the person clicks "Use this page", a quick action or a right-click item. The side
// panel runs readPage in the tab with chrome.scripting.executeScript, so it must not use anything outside itself:
// every helper lives inside it. It only reads; it never clicks, types or changes the page.
//
// A page with a password box is never read: the answer is { blocked: "password" } and no text leaves the page.
// The text is the page's readable words (its article or main part when it has one), cleaned and cut to the limits.

/**
 * Reads the page. `limits` is { text, selection, title } in characters. `doc` and `loc` are the page's own document
 * and location (tests pass stand-ins).
 */
export function readPage(limits, doc = document, loc = location) {
  const clean = (raw) =>
    String(raw ?? "")
      .replace(/\r\n?/g, "\n")
      .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, "")
      .replace(/[^\S\n]+/g, " ")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
      .split("\n")
      .map((l) => l.trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  const cap = (text, max) => {
    if (text.length <= max) return text;
    const head = text.slice(0, max);
    const at = Math.max(head.lastIndexOf("\n"), head.lastIndexOf(" "));
    return (at > 0 && at > max - 300 ? head.slice(0, at) : head).trimEnd();
  };

  const password = doc.querySelector('input[type="password" i], input[autocomplete="current-password"], input[autocomplete="new-password"]');
  if (password) return { blocked: "password", url: String(loc.href) };

  const words = (el) => (el ? String(el.innerText ?? el.textContent ?? "") : "");
  // The article or main part when it holds most of the page, else the whole body.
  let root = doc.body;
  for (const sel of ["article", "main", '[role="main"]']) {
    const el = doc.querySelector(sel);
    if (el && words(el).trim().length >= 500) {
      root = el;
      break;
    }
  }
  const all = clean(words(root));
  const text = cap(all, limits.text);
  const picked = typeof doc.getSelection === "function" ? String(doc.getSelection()?.toString() ?? "") : "";
  return {
    url: String(loc.href),
    title: cap(clean(doc.title).replace(/\s+/g, " "), limits.title),
    text,
    selection: cap(clean(picked), limits.selection),
    cut: text.length < all.length,
  };
}

/** The page's address and whether it has a password box, checked before anything is read. */
export function peekPage(doc = document, loc = location) {
  return { url: String(loc.href), password: Boolean(doc.querySelector('input[type="password" i], input[autocomplete="current-password"], input[autocomplete="new-password"]')) };
}
