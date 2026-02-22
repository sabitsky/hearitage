export const FREE_SCAN_LIMIT = 3;
export const BONUS_SCAN_DURATION_MS = 10 * 60 * 1000;

export type PlanId = "free" | "day" | "week" | "monthly" | "annual";

export type SubscriptionState = {
  deviceId: string;
  plan: PlanId;
  expiresAt: number | null;
  scansToday: number;
  scanDateKey: string;
  bonusScanGrantedAt: number | null;
  bonusScanUsedDateKey: string | null;
  lemonOrderId: string | null;
};

export type PlanInfo = {
  id: PlanId;
  name: string;
  price: string;
  priceNote: string;
  features: string[];
  lemonVariantId: string;
};

export const PLANS: Record<Exclude<PlanId, "free">, PlanInfo> = {
  day: {
    id: "day",
    name: "Day Pass",
    price: "$2.99",
    priceNote: "24 hours",
    features: ["Unlimited scans", "Voice narration (EN)"],
    lemonVariantId: process.env.NEXT_PUBLIC_LEMON_VARIANT_DAY || "",
  },
  week: {
    id: "week",
    name: "Week Pass",
    price: "$5.99",
    priceNote: "7 days",
    features: ["Unlimited scans", "Voice narration", "Multi-language"],
    lemonVariantId: process.env.NEXT_PUBLIC_LEMON_VARIANT_WEEK || "",
  },
  monthly: {
    id: "monthly",
    name: "Monthly",
    price: "$6.99",
    priceNote: "/month",
    features: ["All features", "Gallery history"],
    lemonVariantId: process.env.NEXT_PUBLIC_LEMON_VARIANT_MONTHLY || "",
  },
  annual: {
    id: "annual",
    name: "Annual",
    price: "$39.99",
    priceNote: "/year",
    features: ["All Monthly features", "52% savings"],
    lemonVariantId: process.env.NEXT_PUBLIC_LEMON_VARIANT_ANNUAL || "",
  },
};

export interface SubscriptionProvider {
  getState(): Promise<SubscriptionState>;
  recordScan(): Promise<SubscriptionState>;
  grantBonusScan(): Promise<SubscriptionState>;
  activatePlan(plan: PlanId, orderId: string): Promise<SubscriptionState>;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function isBonusActive(s: SubscriptionState): boolean {
  if (s.bonusScanGrantedAt === null) return false;
  return Date.now() - s.bonusScanGrantedAt < BONUS_SCAN_DURATION_MS;
}

export function getEffectiveState(s: SubscriptionState): SubscriptionState {
  const result = { ...s };
  const today = todayKey();

  if (result.scanDateKey !== today) {
    result.scansToday = 0;
    result.scanDateKey = today;
  }

  if (result.plan !== "free" && result.expiresAt !== null && Date.now() > result.expiresAt) {
    result.plan = "free";
    result.expiresAt = null;
    result.lemonOrderId = null;
  }

  if (!isBonusActive(result)) {
    result.bonusScanGrantedAt = null;
  }

  return result;
}

export function isPaid(s: SubscriptionState): boolean {
  return getEffectiveState(s).plan !== "free";
}

export function canScan(s: SubscriptionState): boolean {
  const eff = getEffectiveState(s);
  if (eff.plan !== "free") return true;
  if (eff.scansToday < FREE_SCAN_LIMIT) return true;
  return isBonusActive(eff);
}

export function remainingFreeScans(s: SubscriptionState): number {
  const eff = getEffectiveState(s);
  if (eff.plan !== "free") return Number.POSITIVE_INFINITY;

  const base = Math.max(0, FREE_SCAN_LIMIT - eff.scansToday);
  if (base > 0) return base;
  if (isBonusActive(eff)) return 1;
  return 0;
}

export function bonusScanRemainingMs(s: SubscriptionState): number {
  const eff = getEffectiveState(s);
  if (eff.bonusScanGrantedAt === null) return 0;
  return Math.max(0, BONUS_SCAN_DURATION_MS - (Date.now() - eff.bonusScanGrantedAt));
}

export function canGrantBonus(s: SubscriptionState): boolean {
  const eff = getEffectiveState(s);
  const today = todayKey();
  if (eff.plan !== "free") return false;
  if (eff.scansToday < FREE_SCAN_LIMIT) return false;
  if (isBonusActive(eff)) return false;
  return eff.bonusScanUsedDateKey !== today;
}

export function canUseVoice(s: SubscriptionState): boolean {
  return isPaid(s);
}

export function canUseLanguage(s: SubscriptionState, lang: string): boolean {
  if (lang === "en") return true;
  const plan = getEffectiveState(s).plan;
  return plan === "week" || plan === "monthly" || plan === "annual";
}
