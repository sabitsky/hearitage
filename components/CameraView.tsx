"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type CameraStatus = "idle" | "loading" | "ready" | "error";
type CameraErrorCode =
  | "api_unavailable"
  | "secure_context"
  | "permission_denied"
  | "camera_busy"
  | "camera_not_found"
  | "playback_failed"
  | "unknown";

type CameraViewProps = {
  onRecognize?: (imageBase64: string) => Promise<void> | void;
  isRecognizing?: boolean;
};

const MAX_IMAGE_SIZE = 1024;
const JPEG_QUALITY = 0.7;

const CAMERA_ERROR_MESSAGES: Record<CameraErrorCode, string> = {
  api_unavailable:
    "Camera API is unavailable in this context. Open in Safari and try again.",
  secure_context:
    "Камера требует HTTPS. Откройте страницу через tunnel URL (https://...loca.lt).",
  permission_denied:
    "Доступ к камере отклонен. Разрешите камеру для сайта и нажмите Retry camera.",
  camera_busy:
    "Камера занята другим приложением. Закройте Camera/Telegram/Zoom и нажмите Retry camera.",
  camera_not_found:
    "Камера не найдена. Проверьте устройство или попробуйте загрузить фото.",
  playback_failed:
    "Не удалось запустить превью камеры. Нажмите Retry camera.",
  unknown: "Не удалось запустить камеру. Нажмите Retry camera.",
};

const getErrorName = (error: unknown) => {
  if (!error || typeof error !== "object") return "";
  const maybeName = (error as { name?: unknown }).name;
  return typeof maybeName === "string" ? maybeName : "";
};

export default function CameraView({
  onRecognize,
  isRecognizing = false,
}: CameraViewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [status, setStatus] = useState<CameraStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<CameraErrorCode | null>(null);
  const [imageData, setImageData] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const setCameraFailure = useCallback((code: CameraErrorCode) => {
    setErrorCode(code);
    setError(CAMERA_ERROR_MESSAGES[code]);
    setStatus("error");
  }, []);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const attachStreamToVideo = useCallback(async () => {
    const stream = streamRef.current;
    const videoElement = videoRef.current;
    if (!stream || !videoElement) return false;

    try {
      if (videoElement.srcObject !== stream) {
        videoElement.srcObject = stream;
      }
      await videoElement.play();
      return true;
    } catch {
      setCameraFailure("playback_failed");
      return false;
    }
  }, [setCameraFailure]);

  useEffect(() => {
    if (status !== "ready" || imageData) return;
    void attachStreamToVideo();
  }, [status, imageData, attachStreamToVideo]);

  useEffect(() => {
    let isActive = true;

    const startCamera = async () => {
      setStatus("loading");
      setError(null);
      setErrorCode(null);

      if (!window.isSecureContext) {
        setCameraFailure("secure_context");
        return;
      }

      if (!navigator?.mediaDevices?.getUserMedia) {
        setCameraFailure("api_unavailable");
        return;
      }

      stopStream();

      try {
        let stream: MediaStream;

        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" } },
            audio: false,
          });
        } catch (preferredError) {
          const preferredErrorName = getErrorName(preferredError);
          if (
            preferredErrorName === "OverconstrainedError" ||
            preferredErrorName === "NotFoundError"
          ) {
            stream = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: false,
            });
          } else {
            throw preferredError;
          }
        }

        if (!isActive) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        setStatus("ready");
        await attachStreamToVideo();
      } catch (cameraError) {
        const errorName = getErrorName(cameraError);

        if (errorName === "NotAllowedError") {
          setCameraFailure("permission_denied");
          return;
        }
        if (errorName === "NotReadableError") {
          setCameraFailure("camera_busy");
          return;
        }
        if (errorName === "SecurityError") {
          setCameraFailure("secure_context");
          return;
        }
        if (errorName === "NotFoundError") {
          setCameraFailure("camera_not_found");
          return;
        }

        setCameraFailure("unknown");
      }
    };

    void startCamera();

    return () => {
      isActive = false;
      stopStream();
    };
  }, [retryNonce, attachStreamToVideo, setCameraFailure, stopStream]);

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

  const handleRetryCamera = () => {
    setImageData(null);
    setRetryNonce((previous) => previous + 1);
  };

  const handleRecognize = async () => {
    if (!imageData || !onRecognize || isRecognizing) return;
    await onRecognize(imageData);
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
          setErrorCode(null);
        }
      };
      image.src = result;
    };

    reader.readAsDataURL(file);
  };

  const showVideoLayer = !imageData;
  const showPlaceholder = !imageData && status !== "ready";

  return (
    <div className="flex-1 flex flex-col items-center justify-between w-full max-w-sm">
      <div className="flex-1 flex items-center justify-center w-full my-8">
        <div className="relative w-full aspect-[3/4] rounded-2xl border border-[var(--color-border)] bg-surface-raised overflow-hidden">
          <div className="absolute top-3 left-3 w-6 h-6 border-t-2 border-l-2 border-brand-400/40 rounded-tl-sm" />
          <div className="absolute top-3 right-3 w-6 h-6 border-t-2 border-r-2 border-brand-400/40 rounded-tr-sm" />
          <div className="absolute bottom-3 left-3 w-6 h-6 border-b-2 border-l-2 border-brand-400/40 rounded-bl-sm" />
          <div className="absolute bottom-3 right-3 w-6 h-6 border-b-2 border-r-2 border-brand-400/40 rounded-br-sm" />

          {showVideoLayer ? (
            <video
              ref={videoRef}
              className={`w-full h-full object-cover transition-opacity duration-200 ${
                status === "ready" ? "opacity-100" : "opacity-0"
              }`}
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
                {status === "loading"
                  ? "Starting camera..."
                  : "Camera is unavailable."}
                <br />
                <span className="text-xs opacity-60">
                  Point at any painting to identify it.
                </span>
              </p>
              {error ? (
                <p className="mt-3 text-xs text-brand-400/80">{error}</p>
              ) : null}
              {errorCode === "secure_context" ? (
                <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                  Use a tunnel URL like <code>https://your-name.loca.lt</code>.
                </p>
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
              disabled={!onRecognize || isRecognizing}
              className="w-full py-4 rounded-2xl bg-brand-500 disabled:bg-brand-500/50 hover:bg-brand-600 active:scale-[0.98] text-white font-semibold text-base tracking-wide transition-all duration-200 ease-out shadow-[0_0_30px_rgba(214,125,36,0.2)]"
            >
              {isRecognizing ? "Analyzing..." : "Recognize Painting"}
            </button>
            <button
              onClick={handleRetake}
              disabled={isRecognizing}
              className="w-full py-3 rounded-2xl border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50 disabled:cursor-not-allowed transition"
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
              disabled={status !== "ready" || isRecognizing}
              className="w-full py-4 rounded-2xl bg-brand-500 disabled:bg-brand-500/40 hover:bg-brand-600 active:scale-[0.98] text-white font-semibold text-base tracking-wide transition-all duration-200 ease-out shadow-[0_0_30px_rgba(214,125,36,0.2)]"
            >
              Scan Painting
            </button>
            {status === "error" ? (
              <>
                <button
                  onClick={handleRetryCamera}
                  disabled={isRecognizing}
                  className="w-full py-3 rounded-2xl border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  Retry camera
                </button>
                <label className="w-full flex items-center justify-center py-3 rounded-2xl border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition cursor-pointer">
                  Upload photo
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                </label>
              </>
            ) : null}
          </>
        )}
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
