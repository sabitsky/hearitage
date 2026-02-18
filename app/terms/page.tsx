export default function TermsPage() {
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
          <h1 className="font-display text-3xl">Terms and Conditions</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Effective date: February 18, 2026
          </p>
        </header>

        <section className="space-y-3 text-sm leading-relaxed text-[var(--color-text-muted)]">
          <p>
            These Terms and Conditions govern your use of Hearitage, an AI-powered
            museum art recognition progressive web app available at{" "}
            <span className="text-[var(--color-text)]">hearitage.com</span>.
          </p>
          <p>
            Hearitage is operated by{" "}
            <span className="text-[var(--color-text)]">Constantine Sabitsky</span>,
            sole proprietor, doing business as Hearitage.
          </p>
          <p>
            By accessing or using Hearitage, you agree to these Terms. If you do
            not agree, do not use the service.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-xl">Service Description</h2>
          <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
            Hearitage provides AI-assisted painting recognition and informational
            content for museum visitors. The service includes free and paid access
            tiers.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-xl">Plans and Billing</h2>
          <div className="text-sm text-[var(--color-text-muted)] space-y-2 leading-relaxed">
            <p>Available plans include Free, Day Pass, Week Pass, Monthly, and Annual.</p>
            <p>
              All payments are processed by{" "}
              <span className="text-[var(--color-text)]">Paddle.com Market Ltd</span>,
              which acts as Merchant of Record.
            </p>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-xl">Content Accuracy</h2>
          <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
            Hearitage uses AI-generated descriptions. While we aim for quality and
            accuracy, outputs may contain errors or omissions. Content is provided
            for informational purposes only.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-xl">Intellectual Property</h2>
          <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
            The Hearitage software, branding, and site materials are protected by
            applicable intellectual property laws. You may not copy, reverse
            engineer, or redistribute service components without permission.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-xl">Limitation of Liability</h2>
          <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
            To the fullest extent permitted by law, Hearitage and Constantine
            Sabitsky are not liable for indirect, incidental, special, or
            consequential damages resulting from use of the service.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-xl">Termination</h2>
          <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
            We may suspend or terminate access if these Terms are violated, if
            abuse is detected, or if required for legal or security reasons.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-xl">Governing Law</h2>
          <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
            These Terms are governed by applicable law of the operator&apos;s
            jurisdiction, unless mandatory consumer law in your jurisdiction
            provides otherwise.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-xl">Contact</h2>
          <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
            For legal and support questions:{" "}
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
