"use client";

// Shared pieces for the Morning Telos screens, built on the current app's classes (src/app/mt.css, ported from
// app/public/app.css): buttons, inputs, cards, page heads, empty states, the drawer, the dropdown and the switch.

import { useEffect, useRef, useState } from "react";
import { Icon, Mark, type IconName } from "./icons";

export const input = "inp";
export const label = "fld-l";
export const btnPrimary = "btn primary full";
export const btnSecondary = "btn full";
export const textLink = "link-u";
/** A small button for rows and toolbars. */
export const btnSmall = "btn sm";
export const btnDanger = "btn danger";
/** A white card for one section of a page. */
export const card = "card pad flex flex-col gap-4";

export function Logo() {
  return (
    <span className="brand">
      <Mark />
      <b>Morning Telos</b>
    </span>
  );
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="err-box">
      {children}
    </p>
  );
}

export function Notice({ children }: { children: React.ReactNode }) {
  return <p className="note-box">{children}</p>;
}

/** A centered card for short screens: new password, set up your business. Like the current app's log in screen. */
export function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-card flex flex-col gap-4">
        <Mark />
        {children}
      </div>
    </div>
  );
}

/** A page's title, the line under it, and its buttons on the right. */
export function PageHead({ title, sub, children }: { title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="ph">
      <div className="min-w-0">
        <h1>{title}</h1>
        {sub ? <p>{sub}</p> : null}
      </div>
      {children ? <div className="ph-act">{children}</div> : null}
    </div>
  );
}

/** A section with a small heading, an optional count and a link on the right. */
export function Section({ title, num, more, className = "", children }: { title: React.ReactNode; num?: number | string; more?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section className={`sec ${className}`}>
      <div className="sh">
        <h2>
          {title}
          {num ? <span className="num">{num}</span> : null}
        </h2>
        {more}
      </div>
      {children}
    </section>
  );
}

/** An empty screen: an optional icon, a short title and one line. */
export function Empty({ title, icon, children }: { title: string; icon?: IconName; children?: React.ReactNode }) {
  return (
    <div className="empty">
      {icon ? (
        <span className="empty-ic">
          <Icon name={icon} />
        </span>
      ) : null}
      <b>{title}</b>
      {children}
    </div>
  );
}

export function Switch({ on, onChange, label: name, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" className="switch" role="switch" aria-checked={on} aria-label={name} disabled={disabled} onClick={() => onChange(!on)} />;
}

/** The side sheet on a computer, a bottom sheet on a phone. Escape and the shade close it. */
export function Drawer({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => closeRef.current?.focus(), 50);
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", key);
      before?.focus?.();
    };
  }, [open, onClose]);
  return (
    <div className={`dw-wrap${open ? " on" : ""}`} aria-hidden={!open} inert={!open}>
      <div className="dw-scrim" onClick={onClose} />
      <aside className="dw" role="dialog" aria-modal="true" aria-label={title}>
        <span className="grab" />
        <div className="dw-h">
          <b>{title}</b>
          <button ref={closeRef} type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="dw-b">{open ? children : null}</div>
      </aside>
    </div>
  );
}

export type DropItem = { v: string; t: string; img?: string; n?: number; sub?: string };

/** The current app's dropdown: a button with the picked item, and a menu with a tick by the picked one. */
export function Dropdown({ label: name, value, items, onChange, left, className = "" }: { label: string; value: string; items: DropItem[]; onChange: (v: string) => void; left?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const cur = items.find((i) => i.v === value) ?? items[0];
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  const pick = (v: string) => {
    setOpen(false);
    if (v !== value) onChange(v);
  };
  const face = (it: DropItem) => (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {it.img ? <img src={it.img} alt="" /> : null}
      <span className="dd-t">{it.t}</span>
    </>
  );
  return (
    <div className={`dd${left ? " left" : ""} ${className}`} ref={box}>
      <button
        type="button"
        className="dd-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={name}
        onClick={() => {
          setHi(Math.max(0, items.findIndex((i) => i.v === value)));
          setOpen(!open);
        }}
        onKeyDown={(e) => {
          if (!open) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
            }
            return;
          }
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setHi((h) => (h + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length);
          } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            pick(items[hi].v);
          } else if (e.key === "Escape" || e.key === "Tab") setOpen(false);
        }}
      >
        <span className="dd-l">{cur ? face(cur) : null}</span>
        <Icon name="down" small />
      </button>
      <div className={`dd-menu${open ? " on" : ""}`} role="listbox" aria-label={name}>
        {items.map((it, i) => (
          <button key={it.v} type="button" role="option" aria-selected={it.v === value} className={i === hi ? "hi" : ""} onClick={() => pick(it.v)}>
            {it.v === value ? <Icon name="tick" small className="tick" /> : <span className="tick" />}
            {face(it)}
            {it.sub ? <small className="dd-sub">{it.sub}</small> : null}
            {it.n != null ? <span className="n">{it.n}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

/** An in-app address for an <a href>. Clicks go through navigate(), so the page changes without a reload. */
export const to = (path: string) => path;
