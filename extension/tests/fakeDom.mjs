// A tiny stand-in for a page's document: enough for the page reader and the Gmail functions. Selectors are matched
// by a test's own function, not by a real CSS engine.

export class FakeEl {
  constructor({ text = "", attrs = {}, kids = [], matches = [] } = {}) {
    this.innerText = text;
    this.attrs = attrs;
    this.kids = kids;
    this.matchesSel = matches;
    this.children = [];
    this.events = [];
    this.focused = false;
  }
  getAttribute(k) {
    return this.attrs[k] ?? null;
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  querySelectorAll(sel) {
    const out = [];
    for (const k of this.kids) {
      if (k.matchesSel.some((m) => sel.includes(m))) out.push(k);
      out.push(...k.querySelectorAll(sel));
    }
    return out;
  }
  closest(sel) {
    return this.matchesSel.some((m) => sel.includes(m)) ? this : null;
  }
  focus() {
    this.focused = true;
  }
  dispatchEvent(e) {
    this.events.push(e.type);
    return true;
  }
  get firstChild() {
    return this.children[0] ?? null;
  }
  insertBefore(node, ref) {
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(node);
    else this.children.splice(i, 0, node);
  }
}

export function fakeDoc({ title = "", body = new FakeEl(), selection = "", typing = true } = {}) {
  const typed = [];
  return {
    title,
    body,
    activeElement: null,
    typed,
    querySelector: (sel) => body.closest(sel) ?? body.querySelector(sel),
    querySelectorAll: (sel) => body.querySelectorAll(sel),
    getSelection: () => ({ toString: () => selection }),
    execCommand(cmd, _ui, value) {
      if (!typing) return false;
      typed.push(cmd === "insertText" ? value : `<${cmd}>`);
      return true;
    },
    createElement: () => ({ textContent: "" }),
  };
}

globalThis.InputEvent ??= class InputEvent extends Event {};
