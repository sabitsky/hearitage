export default function RefundPage() {
  return (
    <main className="min-h-[100dvh] bg-surface text-[var(--color-text)] px-6 py-8">
      <div className="w-full max-w-3xl mx-auto space-y-6">
        <a
          href="/"
          className="inline-block text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition"
        >
          ← Back to Hearitage
        </a>

        <header className="space-y-2">
          <h1 className="font-display text-3xl">Refund Policy</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Effective date: February 18, 2026
          </p>
        </header>

        <section className="space-y-3 text-sm leading-relaxed text-[var(--color-text-muted)]">
          <p>
            All payments are processed by{" "}
            <span className="text-[var(--color-text)]">Paddle.com Market Ltd</span>,
            acting as Merchant of Record for Hearitage.
          </p>
          <p>
            Refund handling is managed according to this policy and Paddle payment
            records.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-xl">Day Pass and Week Pass (One-Time Purchases)</h2>
          <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
            Refund requests can be submitted within 24 hours of purchase if the paid
            service was not used (0 scans after payment activation).
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-xl">Monthly and Annual Plans (Subscriptions)</h2>
          <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
            You can cancel anytime via Paddle Customer Portal. Cancellation stops
            auto-renewal; access remains active until the end of the current paid
            period.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-xl">Auto-Renewal</h2>
          <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
            Subscription plans renew automatically unless canceled before the next
            billing date through Paddle&apos;s customer management tools.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-xl">How to Request a Refund</h2>
          <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
            Contact support or use Paddle customer portal with your transaction
            details:
          </p>
          <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
            <a
              href="mailto:support@hearitage.com"
              className="underline underline-offset-2 hover:text-[var(--color-text)] transition"
            >
              support@hearitage.com
            </a>
          </p>
        </section>
      </div>
    </main>
  );
}
