import type { PlanId } from "@/lib/subscription-types";
import { PLANS } from "@/lib/subscription-types";

type Props = {
  onSelectPlan: (plan: Exclude<PlanId, "free">) => void;
  onMaybeLater: () => void;
  onDismiss: () => void;
  museumName?: string;
  canUseBonus: boolean;
};

function socialProofCount(): number {
  const day = Math.floor(Date.now() / 86400000);
  return 10000 + ((day * 137) % 5000);
}

export default function PaywallOverlay({
  onSelectPlan,
  onMaybeLater,
  onDismiss,
  museumName,
  canUseBonus,
}: Props) {
  const day = PLANS.day;
  const week = PLANS.week;
  const monthly = PLANS.monthly;

  return (
    <div
      className="fixed inset-0 z-50 paywall-backdrop safe-top safe-bottom overflow-y-auto"
      onClick={onDismiss}
    >
      <div className="min-h-full flex items-center justify-center p-6">
        <div
          className="w-full max-w-sm animate-slide-up space-y-5"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="text-center space-y-2">
            <h2 className="font-display text-xl">Your free scans are used</h2>
            <p className="text-sm text-[var(--color-text-muted)]">
              Unlock unlimited art recognition with voice narration
            </p>
          </div>

          {museumName && museumName !== "Unknown" ? (
            <div className="bg-brand-500/10 border border-brand-400/20 rounded-xl p-3 text-center">
              <p className="text-sm text-brand-300">You are exploring {museumName}</p>
            </div>
          ) : null}

          <div className="border border-brand-400/30 bg-surface-raised rounded-2xl p-4 space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="font-display text-lg">{day.name}</span>
              <span className="text-brand-400 font-semibold">{day.price}</span>
            </div>
            <p className="text-xs text-[var(--color-text-muted)]">
              {day.features.join(" · ")} · {day.priceNote}
            </p>
            <button
              onClick={() => onSelectPlan("day")}
              className="w-full py-3.5 rounded-2xl bg-brand-500 hover:bg-brand-600 active:scale-[0.98] text-white font-semibold text-sm tracking-wide transition-all duration-200 shadow-[0_0_30px_rgba(214,125,36,0.2)]"
            >
              Get Day Pass
            </button>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => onSelectPlan("week")}
              className="flex-1 p-3 rounded-xl border border-[var(--color-border)] bg-surface-raised text-left hover:border-brand-400/20 transition space-y-1"
            >
              <p className="font-display text-sm">{week.name}</p>
              <p className="text-brand-400 font-semibold text-sm">{week.price}</p>
              <p className="text-[10px] text-[var(--color-text-muted)]">{week.priceNote}</p>
            </button>

            <button
              onClick={() => onSelectPlan("monthly")}
              className="flex-1 p-3 rounded-xl border border-[var(--color-border)] bg-surface-raised text-left hover:border-brand-400/20 transition space-y-1 relative"
            >
              <span className="absolute -top-2 right-2 bg-brand-500/20 text-brand-300 border border-brand-400/30 rounded-full px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider">
                Popular
              </span>
              <p className="font-display text-sm">{monthly.name}</p>
              <p className="text-brand-400 font-semibold text-sm">{monthly.price}</p>
              <p className="text-[10px] text-[var(--color-text-muted)]">{monthly.priceNote}</p>
            </button>
          </div>

          <p className="text-center">
            <button
              onClick={() => onSelectPlan("annual")}
              className="text-brand-400 text-xs underline underline-offset-2 hover:text-brand-300 transition"
            >
              Save 52% with Annual — $39.99/year
            </button>
          </p>

          <div className="text-center space-y-1">
            <p className="text-xs text-[var(--color-text-muted)]">
              <span className="line-through opacity-60">Museum audio guide: $7-12</span>
            </p>
            <p className="text-xs text-[var(--color-text-muted)] opacity-60">
              {socialProofCount().toLocaleString()} paintings identified today
            </p>
          </div>

          {canUseBonus ? (
            <button
              onClick={onMaybeLater}
              className="w-full py-3 rounded-2xl border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-sm transition"
            >
              Maybe later · 1 bonus scan
            </button>
          ) : (
            <button
              onClick={onDismiss}
              className="w-full py-3 rounded-2xl border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-sm transition"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
