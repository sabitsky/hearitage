import type {
  PlanId,
  SubscriptionProvider,
  SubscriptionState,
} from "@/lib/subscription-types";
import {
  BONUS_SCAN_DURATION_MS,
  canGrantBonus,
  getEffectiveState,
} from "@/lib/subscription-types";

const STORAGE_KEY = "hearitage_sub";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function generateDeviceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createDefault(): SubscriptionState {
  return {
    deviceId: generateDeviceId(),
    plan: "free",
    expiresAt: null,
    scansToday: 0,
    scanDateKey: todayKey(),
    bonusScanGrantedAt: null,
    bonusScanUsedDateKey: null,
    lemonOrderId: null,
  };
}

function load(): SubscriptionState {
  if (typeof window === "undefined") return createDefault();

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const created = createDefault();
      save(created);
      return created;
    }

    const parsed = JSON.parse(raw) as Partial<SubscriptionState>;
    if (!parsed.deviceId || typeof parsed.scansToday !== "number") {
      const created = createDefault();
      save(created);
      return created;
    }

    return {
      deviceId: parsed.deviceId,
      plan:
        parsed.plan === "day" ||
        parsed.plan === "week" ||
        parsed.plan === "monthly" ||
        parsed.plan === "annual" ||
        parsed.plan === "free"
          ? parsed.plan
          : "free",
      expiresAt: typeof parsed.expiresAt === "number" ? parsed.expiresAt : null,
      scansToday: parsed.scansToday,
      scanDateKey:
        typeof parsed.scanDateKey === "string" ? parsed.scanDateKey : todayKey(),
      bonusScanGrantedAt:
        typeof parsed.bonusScanGrantedAt === "number" ? parsed.bonusScanGrantedAt : null,
      bonusScanUsedDateKey:
        typeof parsed.bonusScanUsedDateKey === "string"
          ? parsed.bonusScanUsedDateKey
          : null,
      lemonOrderId:
        typeof parsed.lemonOrderId === "string"
          ? parsed.lemonOrderId
          : null,
    };
  } catch {
    const created = createDefault();
    save(created);
    return created;
  }
}

function save(s: SubscriptionState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // ignore quota/storage exceptions in MVP
  }
}

const PLAN_DURATION_MS: Record<Exclude<PlanId, "free">, number> = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
  annual: 365 * 24 * 60 * 60 * 1000,
};

export class LocalStorageProvider implements SubscriptionProvider {
  async getState(): Promise<SubscriptionState> {
    const s = getEffectiveState(load());
    save(s);
    return s;
  }

  async recordScan(): Promise<SubscriptionState> {
    const s = getEffectiveState(load());
    const hasActiveBonus =
      s.bonusScanGrantedAt !== null &&
      Date.now() - s.bonusScanGrantedAt < BONUS_SCAN_DURATION_MS;

    if (s.plan === "free" && s.scansToday >= 3 && hasActiveBonus) {
      s.bonusScanGrantedAt = null;
    }

    s.scansToday += 1;
    save(s);
    return s;
  }

  async grantBonusScan(): Promise<SubscriptionState> {
    const s = getEffectiveState(load());
    if (!canGrantBonus(s)) {
      save(s);
      return s;
    }

    s.bonusScanGrantedAt = Date.now();
    s.bonusScanUsedDateKey = todayKey();
    save(s);
    return s;
  }

  async activatePlan(plan: PlanId, orderId: string): Promise<SubscriptionState> {
    if (plan === "free") return this.getState();

    const s = getEffectiveState(load());
    s.plan = plan;
    s.expiresAt = Date.now() + PLAN_DURATION_MS[plan];
    s.lemonOrderId = orderId;
    s.bonusScanGrantedAt = null;
    save(s);
    return s;
  }
}
