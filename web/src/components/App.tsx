"use client";

// The whole client app. Sign-in (P1.3) and the workspace screens (P1.5) plug in here.
export function App() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <p className="mb-2 text-[15px] font-semibold">Morning Telos</p>
        <h1 className="mb-3 font-serif text-[32px] leading-tight">Your AI team is almost ready</h1>
        <p className="text-[15px] text-ink-3">Sign-in is coming next.</p>
      </div>
    </main>
  );
}
