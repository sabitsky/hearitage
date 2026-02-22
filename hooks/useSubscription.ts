"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LocalStorageProvider } from "@/lib/subscription-local";
import { openCheckout } from "@/lib/lemon";
import type { PlanId, SubscriptionState } from "@/lib/subscription-types";
import {
  FREE_SCAN_LIMIT,
  bonusScanRemainingMs as bonusRemFn,
  canGrantBonus as canGrantBonusFn,
  canScan as canScanFn,
  getEffectiveState,
  isPaid as isPaidFn,
  remainingFreeScans,
} from "@/lib/subscription-types";

const provider = new LocalStorageProvider();

export function useSubscription() {
  const [sub, setSub] = useState<SubscriptionState | null>(null);
  const [bonusMs, setBonusMs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    void provider.getState().then((s) => setSub(s));
  }, []);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);

    if (!sub || sub.bonusScanGrantedAt === null) {
      setBonusMs(0);
      return;
    }

    const tick = () => {
      const rem = bonusRemFn(sub);
      setBonusMs(rem);
      if (rem <= 0) {
        void provider.getState().then((s) => setSub(s));
        if (timerRef.current) clearInterval(timerRef.current);
      }
    };

    tick();
    timerRef.current = setInterval(tick, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [sub?.bonusScanGrantedAt]);

  const recordScan = useCallback(async () => {
    const s = await provider.recordScan();
    setSub(s);
  }, []);

  const grantBonus = useCallback(async () => {
    const s = await provider.grantBonusScan();
    setSub(s);
  }, []);

  const doActivatePlan = useCallback(async (plan: PlanId, orderId: string) => {
    const s = await provider.activatePlan(plan, orderId);
    setSub(s);
  }, []);

  const doOpenCheckout = useCallback(
    (plan: Exclude<PlanId, "free">) => {
      if (!sub) return;
      void openCheckout(plan, sub.deviceId, (orderId) => {
        void doActivatePlan(plan, orderId);
      });
    },
    [sub, doActivatePlan],
  );

  const eff = sub ? getEffectiveState(sub) : null;

  return {
    sub: eff,
    isPaid: eff ? isPaidFn(eff) : false,
    canScan: eff ? canScanFn(eff) : true,
    canGrantBonus: eff ? canGrantBonusFn(eff) : false,
    remaining: eff ? remainingFreeScans(eff) : FREE_SCAN_LIMIT,
    bonusRemainingMs: bonusMs,
    freeScanLimit: FREE_SCAN_LIMIT,
    recordScan,
    grantBonus,
    activatePlan: doActivatePlan,
    openCheckout: doOpenCheckout,
  };
}
