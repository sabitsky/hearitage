import crypto from "node:crypto";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const secret = process.env.LEMON_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[lemon-webhook] Missing LEMON_WEBHOOK_SECRET");
    return new NextResponse("Server misconfigured", { status: 500 });
  }

  // IMPORTANT: Read raw body BEFORE any JSON parsing.
  // body-parser / json() middleware can alter the body and break HMAC verification.
  const rawBody = await request.text();
  const signature = request.headers.get("x-signature") || "";

  const hmac = crypto.createHmac("sha256", secret);
  const digest = hmac.update(rawBody).digest("hex");

  const digestBuffer = Buffer.from(digest, "utf8");
  const signatureBuffer = Buffer.from(signature, "utf8");

  if (
    digestBuffer.length !== signatureBuffer.length ||
    !crypto.timingSafeEqual(digestBuffer, signatureBuffer)
  ) {
    console.warn("[lemon-webhook] Invalid signature");
    return new NextResponse("Invalid signature", { status: 403 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    console.error("[lemon-webhook] Invalid JSON body");
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  const meta = payload?.meta as Record<string, unknown> | undefined;
  const eventName = meta?.event_name as string | undefined;
  const customData = meta?.custom_data as Record<string, string> | undefined;

  console.info(
    JSON.stringify({
      scope: "lemon-webhook",
      event: eventName || "unknown",
      timestamp: new Date().toISOString(),
      deviceId: customData?.device_id || null,
    }),
  );

  // TODO [paywall-v2]: Process events and update server DB:
  //
  // order_created -> activate one-time plan (Day Pass / Week Pass)
  //   - Extract: meta.custom_data.device_id, data.attributes.first_order_item.variant_id
  //   - Map variant_id to plan (day/week)
  //   - Insert/update subscription record in DB
  //
  // subscription_created -> activate recurring subscription (Monthly / Annual)
  //   - Extract: meta.custom_data.device_id, data.attributes.variant_id
  //   - Map variant_id to plan (monthly/annual)
  //   - Insert subscription record with status=active
  //
  // subscription_updated -> update subscription status
  //   - Check data.attributes.status (active, paused, past_due, cancelled, expired)
  //   - Update DB accordingly
  //
  // subscription_cancelled -> mark as cancelled (still active until period end)
  //   - Update status, set ends_at from data.attributes.ends_at
  //
  // subscription_expired -> deactivate subscription
  //   - Set plan to "free" in DB
  //
  // subscription_payment_success -> log successful payment
  // subscription_payment_failed -> flag for retry / notify user

  // Return 200 quickly — Lemon Squeezy expects fast response
  return new NextResponse("ok", { status: 200 });
}
