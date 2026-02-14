"use client";

import { useEffect, useRef, useState } from "react";

type CameraStatus = "idle" | "ready" | "error";

type CameraViewProps = {
  onRecognize?: (imageBase64: string) => void;
};

const MAX_IMAGE_SIZE = 1024;
const JPEG_QUALITY = 0.7;

export default function CameraView({ onRecognize }: CameraViewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [status, setStatus] = useState<CameraStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [imageData, setImageData] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    const startCamera = async () => {
      if (!navigator?.mediaDevices?.getUserMedia) {
        setError("Camera API is not supported in this браузер.");
        setStatus("error");
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });

        if (!isActive) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setStatus("ready");
      } catch (err) {
        setError("Не удалось получить доступ к камере. Проверьте разрешения.");
        setStatus("error");
      }
    };

    startCamera();

    return () => {
      isActive = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const resizeToCanvas = (source: HTMLImageElement | HTMLVideoElement) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const sourceWidth = "videoWidth" in source ? source.videoWidth : source.width;
    const sourceHeight =
      "videoHeight" in source ? source.videoHeight : source.height;

    if (!sourceWidth || !sourceHeight) return null;

    const scale = Math.min(1, MAX_IMAGE_SIZE / Math.max(sourceWidth, sourceHeight));
    const targetWidth = Math.round(sourceWidth * scale);
    const targetHeight = Math.round(sourceHeight * scale);

    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(source, 0, 0, targetWidth, targetHeight);
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  };

  const handleCapture = () => {
    if (!videoRef.current) return;
    const dataUrl = resizeToCanvas(videoRef.current);
    if (dataUrl) {
      setImageData(dataUrl);
    }
  };

  const handleRetake = () => {
    setImageData(null);
  };

  const handleRecognize = () => {
    if (imageData && onRecognize) {
      onRecognize(imageData);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (!result || typeof result !== "string") return;

      const image = new Image();
      image.onload = () => {
        const dataUrl = resizeToCanvas(image);
        if (dataUrl) {
          setImageData(dataUrl);
          setStatus("ready");
          setError(null);
        }
      };
      image.src = result;
    };

    reader.readAsDataURL(file);
  };

  const showVideo = !imageData && status === "ready";
  const showPlaceholder = !imageData && status !== "ready";

  return (
    <div className="flex-1 flex flex-col items-center justify-between w-full max-w-sm">
      <div className="flex-1 flex items-center justify-center w-full my-8">
        <div className="relative w-full aspect-[3/4] rounded-2xl border border-[var(--color-border)] bg-surface-raised overflow-hidden">
          <div className="absolute top-3 left-3 w-6 h-6 border-t-2 border-l-2 border-brand-400/40 rounded-tl-sm" />
          <div className="absolute top-3 right-3 w-6 h-6 border-t-2 border-r-2 border-brand-400/40 rounded-tr-sm" />
          <div className="absolute bottom-3 left-3 w-6 h-6 border-b-2 border-l-2 border-brand-400/40 rounded-bl-sm" />
          <div className="absolute bottom-3 right-3 w-6 h-6 border-b-2 border-r-2 border-brand-400/40 rounded-br-sm" />

          {showVideo ? (
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              playsInline
              muted
              autoPlay
            />
          ) : null}

          {imageData ? (
            <img
              src={imageData}
              alt="Captured painting"
              className="w-full h-full object-cover"
            />
          ) : null}

          {showPlaceholder ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-8 animate-fade-in">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-overlay flex items-center justify-center">
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-brand-400"
                >
                  <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
                  <circle cx="12" cy="13" r="3" />
                </svg>
              </div>
              <p className="text-[var(--color-text-muted)] text-sm leading-relaxed">
                {status === "error" ? "Camera is unavailable." : "Camera will appear here."}
                <br />
                <span className="text-xs opacity-60">
                  Point at any painting to identify it.
                </span>
              </p>
              {error ? (
                <p className="mt-3 text-xs text-brand-400/80">{error}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="w-full pb-4 space-y-3">
        {imageData ? (
          <>
            <button
              onClick={handleRecognize}
              disabled={!onRecognize}
              className="w-full py-4 rounded-2xl bg-brand-500 disabled:bg-brand-500/50 hover:bg-brand-600 active:scale-[0.98] text-white font-semibold text-base tracking-wide transition-all duration-200 ease-out shadow-[0_0_30px_rgba(214,125,36,0.2)]"
            >
              Recognize Painting
            </button>
            <button
              onClick={handleRetake}
              className="w-full py-3 rounded-2xl border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition"
            >
              Retake
            </button>
            {!onRecognize ? (
              <p className="text-center text-[var(--color-text-muted)] text-xs">
                Recognition will be подключено на следующем шаге.
              </p>
            ) : null}
          </>
        ) : (
          <>
            <button
              onClick={handleCapture}
              disabled={status !== "ready"}
              className="w-full py-4 rounded-2xl bg-brand-500 disabled:bg-brand-500/40 hover:bg-brand-600 active:scale-[0.98] text-white font-semibold text-base tracking-wide transition-all duration-200 ease-out shadow-[0_0_30px_rgba(214,125,36,0.2)]"
            >
              Scan Painting
            </button>
            {status === "error" ? (
              <label className="w-full flex items-center justify-center py-3 rounded-2xl border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition cursor-pointer">
                Upload photo
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </label>
            ) : null}
          </>
        )}
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
