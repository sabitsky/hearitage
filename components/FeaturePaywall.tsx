import type { PlanId } from "@/lib/subscription-types";

type Feature = "voice" | "language" | "gallery";

type Props = {
  feature: Feature;
  onSelectPlan: (plan: Exclude<PlanId, "free">) => void;
  onDismiss: () => void;
};

const CONTENT: Record<Feature, { title: string; desc: string; minPlan: string }> = {
  voice: {
    title: "Voice Narration",
    desc: "Hear the story behind this painting",
    minPlan: "Day Pass ($2.99)",
  },
  language: {
    title: "Multi-language",
    desc: "Listen in Mandarin, Spanish, Hindi and more",
    minPlan: "Week Pass ($5.99)",
  },
  gallery: {
    title: "Gallery History",
    desc: "Save and revisit all your discoveries",
    minPlan: "Monthly ($6.99)",
  },
};

export default function FeaturePaywall({
  feature,
  onSelectPlan,
  onDismiss,
}: Props) {
  const c = CONTENT[feature];
  const plan: Exclude<PlanId, "free"> =
    feature === "gallery" ? "monthly" : feature === "language" ? "week" : "day";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onDismiss}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-sm bg-surface-raised border-t border-[var(--color-border)] rounded-t-2xl p-6 safe-bottom animate-slide-up space-y-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="text-center space-y-1">
          <h3 className="font-display text-lg">{c.title}</h3>
          <p className="text-sm text-[var(--color-text-muted)]">{c.desc}</p>
        </div>
        <button
          onClick={() => onSelectPlan(plan)}
          className="w-full py-3.5 rounded-2xl bg-brand-500 hover:bg-brand-600 active:scale-[0.98] text-white font-semibold text-sm tracking-wide transition-all duration-200 shadow-[0_0_30px_rgba(214,125,36,0.2)]"
        >
          Unlock — {c.minPlan}
        </button>
        <button
          onClick={onDismiss}
          className="w-full text-center text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition py-1"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
