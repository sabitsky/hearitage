"use client";

import { PLANS, type PlanId } from "./subscription-types";

declare global {
  interface Window {
    createLemonSqueezy?: () => void;
    LemonSqueezy?: {
      Url: {
        Open: (url: string) => void;
        Close: () => void;
      };
      Setup: (opts: {
        eventHandler: (event: LemonEvent) => void;
      }) => void;
    };
  }
}

type LemonEvent = {
  event: string;
  data?: {
    order?: {
      data?: {
        id?: string | number;
      };
    };
    [key: string]: unknown;
  };
};

let lemonInitialized = false;
let onSuccessCallback: ((orderId: string) => void) | null = null;
let onCloseCallback: (() => void) | null = null;

export function initLemon(): void {
  if (lemonInitialized) return;
  if (typeof window === "undefined") return;

  if (window.createLemonSqueezy) {
    window.createLemonSqueezy();
  }

  if (window.LemonSqueezy) {
    window.LemonSqueezy.Setup({
      eventHandler: (event: LemonEvent) => {
        if (event.event === "Checkout.Success" && event.data) {
          const orderId = String(event.data?.order?.data?.id || "");
          if (orderId && onSuccessCallback) {
            onSuccessCallback(orderId);
          }
          onSuccessCallback = null;
          onCloseCallback = null;
        }

        if (event.event === "Checkout.Close") {
          onCloseCallback?.();
          onCloseCallback = null;
        }
      },
    });
  }

  lemonInitialized = true;
}

function waitForLemon(timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window !== "undefined" && window.LemonSqueezy) {
      resolve();
      return;
    }

    const start = Date.now();
    const interval = setInterval(() => {
      if (typeof window !== "undefined" && window.LemonSqueezy) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error("Lemon Squeezy SDK did not load in time"));
      }
    }, 100);
  });
}

function buildCheckoutUrl(variantId: string, deviceId: string): string {
  const storeSlug = process.env.NEXT_PUBLIC_LEMON_STORE_SLUG || "";
  const base = `https://${storeSlug}.lemonsqueezy.com/checkout/buy/${variantId}`;
  const params = new URLSearchParams();
  params.set("checkout[custom][device_id]", deviceId);
  params.set("dark", "1");
  params.set("embed", "1");
  return `${base}?${params.toString()}`;
}

export async function openCheckout(
  plan: Exclude<PlanId, "free">,
  deviceId: string,
  onSuccess: (orderId: string) => void,
  onClose?: () => void,
): Promise<void> {
  const planInfo = PLANS[plan];
  if (!planInfo) {
    console.error(`[Hearitage] Unknown plan: ${plan}`);
    return;
  }

  const variantId = planInfo.lemonVariantId;
  if (!variantId) {
    console.error("[Hearitage] Missing Lemon Squeezy variant ID for plan:", plan);
    return;
  }

  try {
    await waitForLemon();
  } catch {
    console.error("[Hearitage] Lemon Squeezy SDK did not load in time");
    return;
  }

  initLemon();

  onSuccessCallback = onSuccess;
  onCloseCallback = onClose || null;

  const url = buildCheckoutUrl(variantId, deviceId);
  window.LemonSqueezy!.Url.Open(url);
}
