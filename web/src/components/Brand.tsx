"use client";

// Settings, General, Brand (owners and admins): the brand learned from the website (supabase/021_brand.sql), each
// value to change, "Use my brand in answers", and "Read my website again". Changes go through POST /api/brand, which
// checks the role and saves as the caller. A small answer shows how the team's replies will look.
// Lifted from Omniscient's Settings, Brand (brand kit), trimmed to what answers use.

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { answerTheme, BRAND_COLUMNS, cleanColor, type BrandRow } from "@/lib/brand";
import { Markdown, ThemeFont } from "./Chat";
import { callApi, message } from "./nav";
import type { Workspace } from "./Settings";
import { ErrorText, input, label, Notice, Switch } from "./ui";
import { plainError } from "@/lib/plainError";

type Fields = { primary_color: string; accent_color: string; heading_font: string; body_font: string; logo_url: string; tone: string };
const FIELDS: (keyof Fields)[] = ["primary_color", "accent_color", "heading_font", "body_font", "logo_url", "tone"];
const toFields = (r: BrandRow | null): Fields => Object.fromEntries(FIELDS.map((k) => [k, r?.[k] ?? ""])) as Fields;

const SAMPLE = `Sales are up **12%** this month.

| Week | Orders |
|---|---|
| 1 | 42 |
| 2 | 47 |

### Next step
- Post the new menu on Friday.`;

/** One color: the swatch and its code. */
function ColorField({ id, name, value, onChange }: { id: string; name: string; value: string; onChange: (v: string) => void }) {
  const c = cleanColor(value);
  const shown = c.ok && c.value ? c.value : null;
  return (
    <div className="fld">
      <label className={label} htmlFor={id}>
        {name}
      </label>
      <div className="flex items-center gap-2">
        <span className="brand-sw" style={shown ? { background: shown } : undefined} aria-hidden="true" />
        <input id={id} className={input} value={value} onChange={(e) => onChange(e.target.value)} placeholder="#1f6feb" autoCapitalize="none" spellCheck={false} maxLength={9} />
      </div>
    </div>
  );
}

export function BrandSettings({ sb, ws }: { sb: SupabaseClient; ws: Workspace }) {
  const [row, setRow] = useState<BrandRow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [f, setF] = useState<Fields>(toFields(null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    let live = true;
    sb.from("brand_kits")
      .select(BRAND_COLUMNS)
      .eq("workspace_id", ws.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!live) return;
        if (error) setError(plainError(error, "We couldn't load your brand. Try again."));
        setRow((data as BrandRow | null) ?? null);
        setF(toFields((data as BrandRow | null) ?? null));
        setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, [sb, ws.id]);

  const changed = FIELDS.some((k) => f[k] !== (row?.[k] ?? ""));
  // The preview follows what is typed, before it is saved.
  const typed = (v: string) => {
    const c = cleanColor(v);
    return c.ok ? c.value : null;
  };
  const preview = answerTheme({ primary_color: typed(f.primary_color), accent_color: typed(f.accent_color), heading_font: f.heading_font.trim() || null, use_brand: true });

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const out = await callApi<{ brand?: BrandRow; message?: string }>(sb, "/api/brand", { workspaceId: ws.id, ...body });
      if (out.brand) {
        setRow(out.brand);
        setF(toFields(out.brand));
      }
      setNote(out.message ?? "Saved.");
    } catch (err) {
      setError(message(err));
    }
    setBusy(false);
  }

  const set = (k: keyof Fields) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  return (
    <section className="sec">
      <div className="sh">
        <h2>Brand</h2>
      </div>
      <form
        className="card pad"
        onSubmit={(e) => {
          e.preventDefault();
          send(f);
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <b className="block text-[14px]">Use my brand in answers</b>
            <small className="block text-[12.5px] text-ink-4">Your colors and fonts in chat, and your tone in what the team writes.</small>
          </span>
          <Switch on={row?.use_brand !== false && Boolean(row)} label="Use my brand in answers" disabled={!loaded || busy || !row} onChange={(on) => send({ use_brand: on })} />
        </div>
        {loaded && !row ? <p className="hint-s mt-3">{ws.website ? "We found no brand on your website yet. Answers use the Morning Telos look." : "Add your website above, or type your brand below."}</p> : null}

        <div className="brand-grid mt-4">
          <div>
            <div className="fld">
              <label className={label} htmlFor="br-logo">
                Logo
              </label>
              <div className="flex items-center gap-2">
                {/* The logo is an image only: never a stylesheet or a font from the website. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {row?.logo_url ? <img className="brand-logo" src={row.logo_url} alt="" referrerPolicy="no-referrer" /> : <span className="brand-logo" aria-hidden="true" />}
                <input id="br-logo" className={input} value={f.logo_url} onChange={(e) => set("logo_url")(e.target.value)} placeholder="https://yourbusiness.com/logo.png" inputMode="url" autoCapitalize="none" spellCheck={false} />
              </div>
            </div>
            <div className="two">
              <ColorField id="br-primary" name="Main color" value={f.primary_color} onChange={set("primary_color")} />
              <ColorField id="br-accent" name="Accent color" value={f.accent_color} onChange={set("accent_color")} />
            </div>
            <div className="two">
              <div className="fld">
                <label className={label} htmlFor="br-head">
                  Heading font
                </label>
                <input id="br-head" className={input} value={f.heading_font} onChange={(e) => set("heading_font")(e.target.value)} placeholder="Lora" />
              </div>
              <div className="fld">
                <label className={label} htmlFor="br-body">
                  Body font
                </label>
                <input id="br-body" className={input} value={f.body_font} onChange={(e) => set("body_font")(e.target.value)} placeholder="Inter" />
              </div>
            </div>
            <p className="hint-s -mt-1 mb-3">Fonts come from Google Fonts.</p>
            <div className="fld">
              <label className={label} htmlFor="br-tone">
                Tone
              </label>
              <input id="br-tone" className={input} value={f.tone} onChange={(e) => set("tone")(e.target.value)} placeholder="warm and simple" maxLength={80} />
            </div>
          </div>
          <div className="brand-prev" aria-label="How answers look">
            <ThemeFont theme={preview} />
            <div style={preview.vars as React.CSSProperties}>
              <Markdown text={SAMPLE} />
            </div>
            {preview.darkened ? <p className="hint-s mt-3">Your main color is light, so answers use a darker shade that is easy to read.</p> : null}
          </div>
        </div>

        {error ? <ErrorText>{error}</ErrorText> : null}
        {note ? <Notice>{note}</Notice> : null}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn primary" disabled={busy || !changed}>
            {busy ? "Saving..." : "Save"}
          </button>
          {ws.website ? (
            <button type="button" className="btn" disabled={busy} onClick={() => send({ action: "rescan" })}>
              Read my website again
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
