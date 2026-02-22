"use client";

import { useState } from "react";
import BonusScanTimer from "@/components/BonusScanTimer";
import CameraView from "@/components/CameraView";
import FeaturePaywall from "@/components/FeaturePaywall";
import PaywallOverlay from "@/components/PaywallOverlay";
import ScanCounter from "@/components/ScanCounter";
import { useSubscription } from "@/hooks/useSubscription";
import type { PlanId } from "@/lib/subscription-types";
import type {
  RecognitionErrorCode,
  RecognitionErrorResponse,
  RecognitionResponse,
} from "@/lib/types";

type RecognitionState = "idle" | "loading" | "success" | "error";
type RecognitionDiagnostics = {
  requestId: string;
  status: number | null;
  contentType: string | null;
  snippet?: string;
};
type LockedFeature = "voice" | "language" | "gallery";

const confidenceStyleMap: Record<RecognitionResponse["confidence"], string> = {
  high: "bg-emerald-500/20 text-emerald-300 border border-emerald-400/40",
  medium: "bg-amber-500/20 text-amber-300 border border-amber-400/40",
  low: "bg-rose-500/20 text-rose-300 border border-rose-400/40",
};

const humanMessageByCode: Record<RecognitionErrorCode, string> = {
  bad_request: "Invalid request. Please retake the photo and try again.",
  misconfigured_env: "Server misconfiguration: missing API key.",
  billing: "API credits exhausted. Please top up and try again.",
  timeout: "Recognition timed out. Check your connection and try again.",
  upstream_error: "Recognition service temporarily unavailable. Please retry.",
  non_json_response: "Unexpected server response. Please try again.",
  network: "Network error. Please check your connection and retry.",
};

const REQUEST_TIMEOUT_MS = 35_000;

const generateRequestId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const toJsonObject = async (response: Response): Promise<Record<string, unknown> | null> => {
  try {
    const parsed = (await response.json()) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
};

export default function Home() {
  const {
    sub,
    isPaid: isPaidUser,
    canScan: canScanNow,
    canGrantBonus,
    bonusRemainingMs,
    freeScanLimit,
    recordScan,
    grantBonus,
    openCheckout,
  } = useSubscription();
  const [recognitionState, setRecognitionState] = useState<RecognitionState>("idle");
  const [recognitionResult, setRecognitionResult] = useState<RecognitionResponse | null>(
    null,
  );
  const [recognitionError, setRecognitionError] =
    useState<RecognitionErrorResponse | null>(null);
  const [recognitionDiagnostics, setRecognitionDiagnostics] =
    useState<RecognitionDiagnostics | null>(null);
  const [cameraKey, setCameraKey] = useState(0);
  const [showPaywall, setShowPaywall] = useState(false);
  const [showFeaturePaywall, setShowFeaturePaywall] =
    useState<LockedFeature | null>(null);

  const handleRecognize = async (imageBase64: string): Promise<boolean> => {
    const clientRequestId = generateRequestId();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    setRecognitionState("loading");
    setRecognitionError(null);
    setRecognitionDiagnostics(null);
    setRecognitionResult(null);

    try {
      const response = await fetch("/api/recognize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-request-id": clientRequestId,
          ...(sub?.deviceId ? { "x-device-id": sub.deviceId } : {}),
        },
        body: JSON.stringify({ imageBase64 }),
        signal: controller.signal,
      });

      const status = response.status;
      const contentType = response.headers.get("content-type");
      const responseRequestId = response.headers.get("x-request-id") || clientRequestId;
      const isJsonResponse = Boolean(contentType?.includes("application/json"));

      if (!isJsonResponse) {
        const rawText = (await response.text().catch(() => "")).trim();
        const snippet = rawText.slice(0, 180);
        const message =
          humanMessageByCode.non_json_response +
          (snippet ? ` (status ${status})` : "");
        setRecognitionDiagnostics({
          requestId: responseRequestId,
          status,
          contentType,
          snippet,
        });
        throw {
          error: message,
          code: "non_json_response",
          requestId: responseRequestId,
        } as RecognitionErrorResponse;
      }

      const payload = await toJsonObject(response);

      if (!response.ok) {
        const code =
          payload && typeof payload.code === "string"
            ? (payload.code as RecognitionErrorCode)
            : "upstream_error";
        const errorMessage =
          payload && typeof payload.error === "string"
            ? payload.error
            : humanMessageByCode[code] || humanMessageByCode.upstream_error;
        const requestId =
          payload && typeof payload.requestId === "string"
            ? payload.requestId
            : responseRequestId;

        setRecognitionDiagnostics({
          requestId,
          status,
          contentType,
        });

        throw {
          error: errorMessage,
          code,
          requestId,
        } as RecognitionErrorResponse;
      }

      if (
        !payload ||
        typeof payload.painting !== "string" ||
        typeof payload.artist !== "string" ||
        typeof payload.confidence !== "string" ||
        typeof payload.summary !== "string" ||
        typeof payload.reasoning !== "string" ||
        typeof payload.requestId !== "string"
      ) {
        setRecognitionDiagnostics({
          requestId: responseRequestId,
          status,
          contentType,
        });
        throw {
          error: "Server returned an unexpected JSON response format.",
          code: "non_json_response",
          requestId: responseRequestId,
        } as RecognitionErrorResponse;
      }

      const normalizedPayload: RecognitionResponse = {
        painting: payload.painting,
        artist: payload.artist,
        year: typeof payload.year === "string" ? payload.year : "Unknown",
        museum: typeof payload.museum === "string" ? payload.museum : "Unknown",
        style: typeof payload.style === "string" ? payload.style : "Unknown",
        confidence:
          payload.confidence === "high" ||
          payload.confidence === "medium" ||
          payload.confidence === "low"
            ? payload.confidence
            : "low",
        summary: payload.summary,
        reasoning: payload.reasoning,
        requestId: payload.requestId,
      };

      setRecognitionResult(normalizedPayload);
      setRecognitionState("success");
      return true;
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") {
        const timeoutError: RecognitionErrorResponse = {
          error: humanMessageByCode.timeout,
          code: "timeout",
          requestId: clientRequestId,
        };
        setRecognitionError(timeoutError);
        setRecognitionDiagnostics({
          requestId: clientRequestId,
          status: null,
          contentType: null,
        });
        setRecognitionState("error");
        return false;
      }

      if (
        error &&
        typeof error === "object" &&
        "error" in error &&
        "code" in error &&
        "requestId" in error
      ) {
        setRecognitionError(error as RecognitionErrorResponse);
        setRecognitionState("error");
        return false;
      }

      const networkError: RecognitionErrorResponse = {
        error:
          error instanceof Error && error.message
            ? `${humanMessageByCode.network} (${error.message})`
            : humanMessageByCode.network,
        code: "network",
        requestId: clientRequestId,
      };
      setRecognitionDiagnostics({
        requestId: clientRequestId,
        status: null,
        contentType: null,
      });
      setRecognitionError(networkError);
      setRecognitionState("error");
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const handleRecognizeWithQuota = async (imageBase64: string) => {
    if (!canScanNow) {
      setShowPaywall(true);
      return;
    }

    const succeeded = await handleRecognize(imageBase64);
    if (succeeded) {
      await recordScan();
    }
  };

  const handleScanAnother = () => {
    setRecognitionState("idle");
    setRecognitionResult(null);
    setRecognitionError(null);
    setRecognitionDiagnostics(null);
    setCameraKey((prev) => prev + 1);
  };

  return (
    <main className="flex-1 flex flex-col items-center px-6 py-4">
      <header className="w-full text-center pt-4">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Hearitage
        </h1>
        <p className="text-brand-400/80 text-[11px] font-semibold tracking-[0.22em] uppercase mt-2">
          AI Art Guide
        </p>
        <p className="text-[var(--color-text-muted)] text-xs mt-1 font-light opacity-50">
          Point. Scan. Listen.
        </p>
      </header>

      <div className="relative w-full max-w-sm">
        {sub && !isPaidUser && recognitionState === "idle" ? (
          <ScanCounter
            scansUsed={sub.scansToday}
            scanLimit={freeScanLimit}
            isPaid={false}
          />
        ) : null}
        {sub && isPaidUser && recognitionState === "idle" ? (
          <ScanCounter scansUsed={0} scanLimit={0} isPaid planName={sub.plan} />
        ) : null}
        {bonusRemainingMs > 0 && recognitionState === "idle" ? (
          <BonusScanTimer remainingMs={bonusRemainingMs} />
        ) : null}
        <CameraView
          key={cameraKey}
          onRecognize={handleRecognizeWithQuota}
          isRecognizing={recognitionState === "loading"}
        />
      </div>

      {recognitionState === "loading" ? (
        <div className="w-full max-w-sm mb-4 p-4 rounded-2xl border border-[var(--color-border)] bg-surface-raised">
          <p className="text-sm text-[var(--color-text-muted)]">
            Analyzing painting... This usually takes a few seconds.
          </p>
        </div>
      ) : null}

      {recognitionState === "error" && recognitionError ? (
        <div className="w-full max-w-sm mb-4 p-4 rounded-2xl border border-rose-400/30 bg-rose-500/10">
          <p className="text-sm text-rose-200">{recognitionError.error}</p>
          <p className="mt-2 text-xs text-rose-100/90">
            Code: <code>{recognitionError.code}</code>
          </p>
          <p className="mt-1 text-xs text-rose-100/90">
            Request ID: <code>{recognitionError.requestId}</code>
          </p>
          {process.env.NODE_ENV !== "production" && recognitionDiagnostics ? (
            <div className="mt-2 rounded-xl border border-rose-300/30 p-2">
              <p className="text-[11px] text-rose-100/90">
                Status:{" "}
                <code>
                  {recognitionDiagnostics.status === null
                    ? "n/a"
                    : recognitionDiagnostics.status}
                </code>
              </p>
              <p className="text-[11px] text-rose-100/90">
                Content-Type:{" "}
                <code>{recognitionDiagnostics.contentType || "n/a"}</code>
              </p>
              {recognitionDiagnostics.snippet ? (
                <p className="text-[11px] text-rose-100/90 mt-1 break-words">
                  Snippet: <code>{recognitionDiagnostics.snippet}</code>
                </p>
              ) : null}
            </div>
          ) : null}
          <button
            onClick={handleScanAnother}
            className="mt-3 w-full py-2.5 rounded-xl border border-rose-300/40 text-rose-100 hover:bg-rose-500/20 transition"
          >
            Try again
          </button>
        </div>
      ) : null}

      {recognitionState === "success" && recognitionResult ? (
        <section className="w-full max-w-sm mb-6 p-4 rounded-2xl border border-[var(--color-border)] bg-surface-raised space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-xl leading-tight">
              {recognitionResult.painting}
            </h2>
            <span
              className={`px-2.5 py-1 rounded-full text-xs font-medium uppercase tracking-wide ${confidenceStyleMap[recognitionResult.confidence]}`}
            >
              {recognitionResult.confidence}
            </span>
          </div>
          <p className="text-sm text-[var(--color-text-muted)]">
            {recognitionResult.artist} · {recognitionResult.year}
          </p>
          <p className="text-sm text-[var(--color-text-muted)]">
            Museum: {recognitionResult.museum}
          </p>
          <p className="text-sm text-[var(--color-text-muted)]">
            Style: {recognitionResult.style}
          </p>
          <p className="text-sm leading-relaxed">{recognitionResult.summary}</p>
          {recognitionResult.confidence !== "high" && recognitionResult.reasoning ? (
            <p className="text-xs text-[var(--color-text-muted)] italic mt-2">
              {recognitionResult.reasoning}
            </p>
          ) : null}
          {process.env.NODE_ENV !== "production" ? (
            <p className="text-xs text-[var(--color-text-muted)]">
              Request ID: <code>{recognitionResult.requestId}</code>
            </p>
          ) : null}
          <button
            onClick={handleScanAnother}
            className="mt-1 w-full py-3 rounded-xl border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition"
          >
            Scan another
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (!isPaidUser) setShowFeaturePaywall("voice");
              }}
              className="flex-1 py-2.5 rounded-xl border border-[var(--color-border)] text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition flex items-center justify-center gap-2"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
              Listen
              {!isPaidUser ? (
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="opacity-40"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              ) : null}
            </button>
            <button
              onClick={() => {
                if (!isPaidUser) setShowFeaturePaywall("language");
              }}
              className="flex-1 py-2.5 rounded-xl border border-[var(--color-border)] text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition flex items-center justify-center gap-2"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              Language
              {!isPaidUser ? (
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="opacity-40"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              ) : null}
            </button>
          </div>
        </section>
      ) : null}

      <footer className="text-center text-xs pb-4 space-y-2">
        <p className="text-[var(--color-text-muted)]">Hearitage beta</p>
        <nav className="flex justify-center gap-4 text-[var(--color-text-muted)]">
          <a
            href="/terms"
            className="underline underline-offset-2 hover:text-[var(--color-text)] transition"
          >
            Terms
          </a>
          <a
            href="/privacy"
            className="underline underline-offset-2 hover:text-[var(--color-text)] transition"
          >
            Privacy
          </a>
          <a
            href="/refund"
            className="underline underline-offset-2 hover:text-[var(--color-text)] transition"
          >
            Refunds
          </a>
        </nav>
      </footer>

      {showPaywall ? (
        <PaywallOverlay
          onSelectPlan={(plan: Exclude<PlanId, "free">) => {
            openCheckout(plan);
            setShowPaywall(false);
          }}
          onMaybeLater={() => {
            void grantBonus();
            setShowPaywall(false);
          }}
          onDismiss={() => setShowPaywall(false)}
          museumName={recognitionResult?.museum}
          canUseBonus={canGrantBonus}
        />
      ) : null}

      {showFeaturePaywall ? (
        <FeaturePaywall
          feature={showFeaturePaywall}
          onSelectPlan={(plan: Exclude<PlanId, "free">) => {
            openCheckout(plan);
            setShowFeaturePaywall(null);
          }}
          onDismiss={() => setShowFeaturePaywall(null)}
        />
      ) : null}
    </main>
  );
}
