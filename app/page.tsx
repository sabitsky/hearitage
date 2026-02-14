"use client";

import { useState } from "react";
import CameraView from "@/components/CameraView";
import type { RecognitionResponse } from "@/lib/types";

type RecognitionState = "idle" | "loading" | "success" | "error";

const confidenceStyleMap: Record<RecognitionResponse["confidence"], string> = {
  high: "bg-emerald-500/20 text-emerald-300 border border-emerald-400/40",
  medium: "bg-amber-500/20 text-amber-300 border border-amber-400/40",
  low: "bg-rose-500/20 text-rose-300 border border-rose-400/40",
};

export default function Home() {
  const [recognitionState, setRecognitionState] = useState<RecognitionState>("idle");
  const [recognitionResult, setRecognitionResult] = useState<RecognitionResponse | null>(
    null,
  );
  const [recognitionError, setRecognitionError] = useState<string | null>(null);
  const [cameraKey, setCameraKey] = useState(0);

  const handleRecognize = async (imageBase64: string) => {
    setRecognitionState("loading");
    setRecognitionError(null);
    setRecognitionResult(null);

    try {
      const response = await fetch("/api/recognize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ imageBase64 }),
      });

      const payload = (await response.json().catch(() => null)) as
        | RecognitionResponse
        | { error?: string }
        | null;

      if (!response.ok) {
        const errorMessage =
          payload &&
          typeof payload === "object" &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "Не удалось распознать картину. Попробуйте снова.";
        throw new Error(errorMessage);
      }

      if (!payload || typeof payload !== "object" || !("painting" in payload)) {
        throw new Error("Сервер вернул неожиданный формат ответа.");
      }

      setRecognitionResult(payload as RecognitionResponse);
      setRecognitionState("success");
    } catch (error) {
      setRecognitionError(
        error instanceof Error
          ? error.message
          : "Произошла ошибка при распознавании. Попробуйте еще раз.",
      );
      setRecognitionState("error");
    }
  };

  const handleScanAnother = () => {
    setRecognitionState("idle");
    setRecognitionResult(null);
    setRecognitionError(null);
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
          <p className="text-sm text-rose-200">{recognitionError}</p>
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
