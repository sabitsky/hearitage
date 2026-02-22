type Props = {
  scansUsed: number;
  scanLimit: number;
  isPaid: boolean;
  planName?: string;
};

export default function ScanCounter({
  scansUsed,
  scanLimit,
  isPaid,
  planName,
}: Props) {
  if (isPaid) {
    return (
      <span className="absolute top-4 right-4 z-10 animate-fade-in bg-emerald-500/10 text-emerald-300 border border-emerald-400/20 rounded-full px-3 py-1 text-xs font-medium capitalize">
        {planName || "Premium"} ✓
      </span>
    );
  }

  const remaining = Math.max(0, scanLimit - scansUsed);
  const isLast = remaining === 1;

  return (
    <span
      className={`absolute top-4 right-4 z-10 animate-fade-in bg-brand-500/10 text-brand-300 border border-brand-400/20 rounded-full px-3 py-1 text-xs font-medium ${
        isLast ? "animate-pulse-slow" : ""
      }`}
    >
      {isLast ? "Last free scan" : `${scansUsed} of ${scanLimit} free`}
    </span>
  );
}
