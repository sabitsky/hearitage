export default function PrivacyPage() {
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
          <h1 className="font-display text-3xl">Privacy Policy</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Effective date: February 18, 2026
          </p>
        </header>

        <section className="space-y-2 text-sm leading-relaxed text-[var(--color-text-muted)]">
          <p>
            This Privacy Policy explains how data is handled when you use Hearitage
            on hearitage.com.
          </p>
          <p>
            Data controller/operator:{" "}
            <span className="text-[var(--color-text)]">Constantine Sabitsky</span>{" "}
            (Hearitage).
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-xl">What We Collect</h2>
          <ul className="list-disc pl-5 space-y-2 text-sm text-[var(--color-text-muted)] leading-relaxed">
            <li>
              Painting images submitted for recognition. Images are processed via
              API calls and are not stored as a user gallery on Hearitage servers.
            </li>
            <li>
              Device identifier generated locally in your browser for scan quota
              logic.
            </li>
            <li>
              Email address and billing metadata when you pay, handled by Paddle.
            </li>
            <li>Technical request data such as IP address and user-agent in server logs.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-xl">How Data Is Used</h2>
          <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
            Data is used only to deliver the service: recognize artworks, return AI
            descriptions, operate quotas/subscriptions, process payments, and
            maintain service reliability and security.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-xl">Third-Party Processors</h2>
          <ul className="list-disc pl-5 space-y-2 text-sm text-[var(--color-text-muted)] leading-relaxed">
            <li>Anthropic (Claude API) for AI image understanding and text generation.</li>
            <li>Google Cloud Vision API for image recognition support.</li>
            <li>Paddle.com Market Ltd for payment processing and billing compliance.</li>
            <li>Vercel for hosting and infrastructure logs.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-xl">Cookies and Local Storage</h2>
          <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
            Hearitage uses browser storage (localStorage) for MVP subscription state
            and device identifier. Essential cookies may also be used by platform
            providers to keep the app functional.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-xl">Your Rights</h2>
          <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
            You may request access, correction, or deletion of personal data where
            applicable by contacting us at support@hearitage.com.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-xl">Security</h2>
          <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
            Hearitage is served over HTTPS. Payment card data is not stored by
            Hearitage; payment handling is delegated to Paddle.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-xl">Contact</h2>
          <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
            Privacy requests:{" "}
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
