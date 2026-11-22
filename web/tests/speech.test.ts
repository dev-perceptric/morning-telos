// Voice typing in the message box (src/lib/speech.ts). Pure: no browser and no microphone.
import assert from "node:assert/strict";
import { test } from "node:test";
import { micError, speechLang, speechRecognition, spokenText, withSpoken } from "../src/lib/speech.ts";

test("speechRecognition: the standard one, then Chrome and Safari's, else none (the mic is hidden)", () => {
  class Std {}
  class Webkit {}
  assert.equal(speechRecognition({ SpeechRecognition: Std, webkitSpeechRecognition: Webkit }), Std);
  assert.equal(speechRecognition({ webkitSpeechRecognition: Webkit }), Webkit);
  assert.equal(speechRecognition({}), null, "Firefox");
  assert.equal(speechRecognition({ SpeechRecognition: "nope" }), null);
  assert.equal(speechRecognition(null), null);
  assert.equal(speechRecognition(undefined), null, "no window, on the server");
});

test("speechLang: the browser's language, else English", () => {
  assert.equal(speechLang({ languages: ["vi-VN", "en-US"], language: "en-US" }), "vi-VN");
  assert.equal(speechLang({ language: "es-MX" }), "es-MX");
  assert.equal(speechLang({ language: "fr" }), "fr");
  assert.equal(speechLang({ language: "" }), "en-US");
  assert.equal(speechLang({ language: "not a tag!" }), "en-US");
  assert.equal(speechLang(undefined), "en-US");
});

const result = (transcript: string, isFinal: boolean) => Object.assign([{ transcript }], { isFinal });

test("spokenText: settled words and the words still being heard", () => {
  assert.deepEqual(spokenText([result("Draft a post ", true), result(" about our  new", false), result(" bread", false)]), { final: "Draft a post", interim: "about our new bread" });
  assert.deepEqual(spokenText([]), { final: "", interim: "" });
});

test("withSpoken: spoken words follow what was typed, with one space", () => {
  assert.equal(withSpoken("", { final: "Hello", interim: "team" }), "Hello team");
  assert.equal(withSpoken("@Leo", { final: "post this", interim: "" }), "@Leo post this");
  assert.equal(withSpoken("Hi ", { final: "there", interim: "" }), "Hi there");
  assert.equal(withSpoken("Typed", { final: "", interim: "" }), "Typed");
});

test("micError: one short line, and nothing when the person stopped it", () => {
  assert.match(micError("not-allowed")!, /microphone is blocked/);
  assert.equal(micError("service-not-allowed"), micError("not-allowed"));
  assert.match(micError("audio-capture")!, /couldn't find a microphone/);
  assert.match(micError("no-speech")!, /didn't hear anything/);
  assert.equal(micError("aborted"), null);
  assert.match(micError("something-new")!, /Try again/);
  for (const code of ["not-allowed", "audio-capture", "no-speech", "network", "language-not-supported", "x"]) assert.doesNotMatch(micError(code)!, /[–—]/);
});
