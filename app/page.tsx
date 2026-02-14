"use client";

import CameraView from "@/components/CameraView";

export default function Home() {
  return (
    <main className="flex-1 flex flex-col items-center justify-between px-6 py-8">
      <header className="w-full text-center pt-4">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Hearitage
        </h1>
        <p className="text-[var(--color-text-muted)] text-sm mt-1 font-light">
          Point. Scan. Listen.
        </p>
      </header>

      <CameraView />

      <p className="text-center text-[var(--color-text-muted)] text-xs pb-4">
        Free · No sign-up required
      </p>
    </main>
  );
}
