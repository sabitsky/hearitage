"use client";

import { useState } from "react";
import CameraView from "@/components/CameraView";
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

const confidenceStyleMap: Record<RecognitionResponse["confidence"], string> = {
  high: "bg-emerald-500/20 text-emerald-300 border border-emerald-400/40",
  medium: "bg-amber-500/20 text-amber-300 border border-amber-400/40",
  low: "bg-rose-500/20 text-rose-300 border border-rose-400/40",
};

const humanMessageByCode: Record<RecognitionErrorCode, string> = {
  bad_request: "Некорректный запрос распознавания. Переснимите картину и попробуйте снова.",
  misconfigured_env:
    "Server misconfiguration: missing ANTHROPIC_API_KEY in deployment.",
  billing:
    "Не хватает баланса Claude API. Пополните кредиты и повторите попытку.",
  timeout: "Claude не ответил вовремя. Проверьте сеть и попробуйте еще раз.",
  upstream_error: "Сервис распознавания временно недоступен. Повторите попытку.",
  non_json_response:
    "Туннель/прокси вернул неожиданный ответ. Перезапустите tunnel и попробуйте снова.",
  network: "Сетевой сбой при обращении к API. Проверьте соединение и повторите попытку.",
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
  const [recognitionState, setRecognitionState] = useState<RecognitionState>("idle");
  const [recognitionResult, setRecognitionResult] = useState<RecognitionResponse | null>(
    null,
  );
  const [recognitionError, setRecognitionError] =
    useState<RecognitionErrorResponse | null>(null);
  const [recognitionDiagnostics, setRecognitionDiagnostics] =
    useState<RecognitionDiagnostics | null>(null);
  const [cameraKey, setCameraKey] = useState(0);

  const handleRecognize = async (imageBase64: string) => {
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
        typeof payload.requestId !== "string"
      ) {
        setRecognitionDiagnostics({
          requestId: responseRequestId,
          status,
          contentType,
        });
        throw {
          error: "Сервер вернул неожиданный JSON-формат ответа.",
          code: "non_json_response",
          requestId: responseRequestId,
        } as RecognitionErrorResponse;
      }

      setRecognitionResult(payload as RecognitionResponse);
      setRecognitionState("success");
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
        return;
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
        return;
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
    } finally {
      clearTimeout(timeoutId);
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
    <main className="flex-1 flex flex-col items-center px-6 py-8">
      <header className="w-full text-center pt-4">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Hearitage
        </h1>
        <p className="text-[var(--color-text-muted)] text-sm mt-1 font-light">
          Point. Scan. Listen.
        </p>
      </header>

      <CameraView
        key={cameraKey}
        onRecognize={handleRecognize}
        isRecognizing={recognitionState === "loading"}
      />

      {recognitionState === "loading" ? (
        <div className="w-full max-w-sm mb-4 p-4 rounded-2xl border border-[var(--color-border)] bg-surface-raised">
          <p className="text-sm text-[var(--color-text-muted)]">
            Анализирую изображение... Обычно это занимает несколько секунд.
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
            Попробовать снова
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
            Музей: {recognitionResult.museum}
          </p>
          <p className="text-sm text-[var(--color-text-muted)]">
            Стиль: {recognitionResult.style}
          </p>
          <p className="text-sm leading-relaxed">{recognitionResult.summary}</p>
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
        </section>
      ) : null}

      <p className="text-center text-[var(--color-text-muted)] text-xs pb-4">
        M1 local test mode
      </p>
    </main>
  );
}
