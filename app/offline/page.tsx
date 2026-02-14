export default function Offline() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center px-6 text-center">
      <div className="w-16 h-16 mb-6 rounded-full bg-surface-raised flex items-center justify-center">
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-[var(--color-text-muted)]"
        >
          <line x1="1" y1="1" x2="23" y2="23" />
          <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
          <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
          <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
          <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
          <line x1="12" y1="20" x2="12.01" y2="20" />
        </svg>
      </div>
      <h1 className="font-display text-2xl font-semibold mb-2">
        You&apos;re Offline
      </h1>
      <p className="text-[var(--color-text-muted)] text-sm max-w-xs leading-relaxed">
        Hearitage needs an internet connection to identify paintings. Please
        reconnect and try again.
      </p>
    </main>
  );
}
