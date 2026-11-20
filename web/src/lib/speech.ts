// Voice typing in the message box with the browser's own speech recognition (SpeechRecognition, or
// webkitSpeechRecognition in Chrome and Safari). Words show in the box while the person speaks, and they can edit
// them before sending. Nothing is recorded or sent to us: the browser does the listening. Pure, so tests cover it.

/** The part of the browser's recognition object the message box uses. */
export type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
export type RecognitionMaker = new () => Recognition;

/** The browser's speech recognition, or null when it has none (then the mic is hidden). */
export function speechRecognition(w: unknown): RecognitionMaker | null {
  if (!w || typeof w !== "object") return null;
  const g = w as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  const make = g.SpeechRecognition ?? g.webkitSpeechRecognition;
  return typeof make === "function" ? (make as RecognitionMaker) : null;
}

/** The language to listen for: the browser's own, like "en-US". English when it says nothing usable. */
export function speechLang(nav: { language?: string; languages?: readonly string[] } | null | undefined): string {
  const tag = [nav?.languages?.[0], nav?.language].find((l) => typeof l === "string" && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/i.test(l));
  return tag ?? "en-US";
}

/** What was said so far: the settled words, and the words still being heard. */
export function spokenText(results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>): { final: string; interim: string } {
  let final = "";
  let interim = "";
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const words = r?.[0]?.transcript ?? "";
    if (r.isFinal) final += words;
    else interim += words;
  }
  const tidy = (s: string) => s.replace(/\s+/g, " ").trim();
  return { final: tidy(final), interim: tidy(interim) };
}

/** The box's text with the spoken words after what was typed before the mic was turned on. */
export function withSpoken(before: string, spoken: { final: string; interim: string }): string {
  const said = [spoken.final, spoken.interim].filter(Boolean).join(" ");
  if (!said) return before;
  if (!before) return said;
  return /\s$/.test(before) ? `${before}${said}` : `${before} ${said}`;
}

export const MIC_WORDS = {
  start: "Talk instead of typing",
  stop: "Stop listening",
  listening: "Listening. Tap the mic to stop.",
} as const;

/** One short line for a recognition error, or null when there is nothing to say (the person stopped it). */
export function micError(code: string): string | null {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Your microphone is blocked. Allow it in your browser's settings, then try again.";
    case "audio-capture":
      return "We couldn't find a microphone.";
    case "no-speech":
      return "We didn't hear anything. Try again.";
    case "network":
      return "Voice typing needs an internet connection. Try again.";
    case "language-not-supported":
      return "Your browser can't listen in this language.";
    case "aborted":
      return null;
    default:
      return "Voice typing stopped. Try again.";
  }
}
