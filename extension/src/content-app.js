// On Morning Telos's own pages only (chat.morningtelos.com): tells Settings, Chrome extension that the extension is
// here, and takes the session that page hands over when the person clicks Connect this browser. Copied from
// Omniscient's content-app.js. The names match web/src/lib/extensionConnect.ts.
(() => {
  document.documentElement.dataset.morningtelosExtension = "1";
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.origin !== location.origin || e.data?.type !== "morningtelos-extension-session") return;
    chrome.runtime.sendMessage({ type: "session", handover: e.data }, (r) => {
      window.postMessage({ type: "morningtelos-extension-connected", ok: Boolean(r?.ok) }, location.origin);
    });
  });
})();
