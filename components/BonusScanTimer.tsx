import { BONUS_SCAN_DURATION_MS } from "@/lib/subscription-types";

type Props = { remainingMs: number };

export default function BonusScanTimer({ remainingMs }: Props) {
  const totalSec = Math.ceil(remainingMs / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const pct = Math.max(0, (remainingMs / BONUS_SCAN_DURATION_MS) * 100);

  return (
    <div className="absolute top-0 left-0 right-0 z-10 animate-fade-in">
      <div className="bg-amber-500/10 backdrop-blur-sm border-b border-amber-400/20 py-1.5 text-center">
        <span className="text-amber-300 text-xs font-medium">
          Bonus scan · {min}:{sec.toString().padStart(2, "0")}
        </span>
      </div>
      <div className="h-0.5 bg-amber-400/10">
        <div
          className="h-full bg-amber-400/30 transition-all duration-1000 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
