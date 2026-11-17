// Small shared pieces for the Morning Telos screens, in the current app's style.

export const input =
  "w-full h-11 rounded-[10px] border border-line bg-surface px-3 text-[15px] text-ink outline-none transition focus:border-ink-3 focus:ring-2 focus:ring-clay/20";
export const label = "mb-1.5 block text-[13px] font-medium text-ink-2";
export const btnPrimary =
  "inline-flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-ink px-4 text-[15px] font-semibold text-white transition hover:bg-clay disabled:opacity-60";
export const btnSecondary =
  "inline-flex h-11 w-full items-center justify-center gap-3 rounded-[10px] border border-line bg-surface px-4 text-[15px] font-medium text-ink transition hover:border-line-2 hover:bg-sunk disabled:opacity-60";
export const textLink = "font-medium text-clay-2 underline-offset-2 hover:underline";

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-8 w-8 place-items-center rounded-[9px] bg-ink" aria-hidden>
        <svg width="18" height="13" viewBox="0 0 18 13" fill="none">
          <path d="M1 12a8 8 0 0 1 16 0" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
          <path d="M9 1v2M3.3 3.3l1.4 1.4M14.7 3.3l-1.4 1.4" stroke="#d97757" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
      <span className="text-[16px] font-semibold tracking-[-0.01em]">Morning Telos</span>
    </div>
  );
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-[10px] bg-[#fbeae4] px-3 py-2 text-[14px] text-red">
      {children}
    </p>
  );
}

export function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-[10px] bg-clay-bg px-3 py-2 text-[14px] text-ink-2">{children}</p>;
}

/** A centered card for short screens: new password, set up your business. */
export function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen justify-center px-4 py-12">
      <div className="flex w-full max-w-md flex-col gap-6">
        <Logo />
        <div className="flex flex-col gap-5 rounded-2xl border border-line bg-surface p-6 shadow-sm">{children}</div>
      </div>
    </main>
  );
}
