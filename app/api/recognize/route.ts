import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type {
  RecognitionConfidence,
  RecognitionErrorCode,
  RecognitionErrorResponse,
  RecognitionResponse,
} from "@/lib/types";

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
const IMAGE_DATA_URL_PATTERN =
  /^data:(image\/(?:jpeg|jpg|png|gif|webp));base64,([A-Za-z0-9+/=]+)$/;
const RECOGNIZE_TIMEOUT_MS = 30_000;

const FALLBACK_RESPONSE: Omit<RecognitionResponse, "requestId"> = {
  painting: "unknown",
  artist: "unknown",
  year: "unknown",
  museum: "unknown",
  style: "unknown",
  confidence: "low",
  summary:
    "Не удалось уверенно распознать картину. Попробуйте переснять изображение ближе и без бликов.",
};

type RecognizeRequestBody = {
  imageBase64?: unknown;
};

type NormalizedError = {
  code: RecognitionErrorCode;
  status: number;
  message: string;
  retryable: boolean;
};

const normalizeMediaType = (
  mediaType: string,
): "image/jpeg" | "image/png" | "image/gif" | "image/webp" => {
  switch (mediaType.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return "image/jpeg";
    case "image/png":
      return "image/png";
    case "image/gif":
      return "image/gif";
    case "image/webp":
      return "image/webp";
    default:
      return "image/jpeg";
  }
};

const asText = (value: unknown) => {
  if (typeof value !== "string") return "unknown";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "unknown";
};

const asConfidence = (value: unknown): RecognitionConfidence => {
  if (typeof value !== "string") return "low";
  const normalized = value.trim().toLowerCase();
  if (normalized === "high" || normalized === "medium" || normalized === "low") {
    return normalized;
  }
  return "low";
};

const sanitizeResponse = (raw: unknown): Omit<RecognitionResponse, "requestId"> => {
  if (!raw || typeof raw !== "object") return FALLBACK_RESPONSE;
  const payload = raw as Record<string, unknown>;

  return {
    painting: asText(payload.painting),
    artist: asText(payload.artist),
    year: asText(payload.year),
    museum: asText(payload.museum),
    style: asText(payload.style),
    confidence: asConfidence(payload.confidence),
    summary: asText(payload.summary),
  };
};

const extractJson = (modelText: string) => {
  if (!modelText) return null;

  const fenced =
    modelText.match(/```json\s*([\s\S]*?)```/i) ||
    modelText.match(/```\s*([\s\S]*?)```/);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = modelText.indexOf("{");
  const end = modelText.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  return modelText.slice(start, end + 1).trim();
};

const parseRequestBody = async (request: Request): Promise<RecognizeRequestBody | null> => {
  try {
    return (await request.json()) as RecognizeRequestBody;
  } catch {
    return null;
  }
};

const createRequestId = (request: Request) => {
  const fromHeader = request.headers.get("x-request-id");
  if (fromHeader && fromHeader.trim().length > 0 && fromHeader.length <= 120) {
    return fromHeader.trim();
  }
  return randomUUID();
};

const logStage = (
  requestId: string,
  stage: string,
  details: Record<string, unknown> = {},
) => {
  const entry = {
    scope: "recognize",
    requestId,
    stage,
    timestamp: new Date().toISOString(),
    ...details,
  };
  console.info(JSON.stringify(entry));
};

const createErrorResponse = (
  requestId: string,
  status: number,
  code: RecognitionErrorCode,
  message: string,
) => {
  const payload: RecognitionErrorResponse = {
    error: message,
    code,
    requestId,
  };
  return NextResponse.json(payload, {
    status,
    headers: {
      "x-request-id": requestId,
    },
  });
};

const createSuccessResponse = (
  requestId: string,
  payload: Omit<RecognitionResponse, "requestId">,
) => {
  const response: RecognitionResponse = {
    ...payload,
    requestId,
  };
  return NextResponse.json(response, {
    status: 200,
    headers: {
      "x-request-id": requestId,
    },
  });
};

const isBillingIssue = (message: string) =>
  /billing|credit|balance|payment|fund|quota/i.test(message);

const normalizeError = (error: unknown): NormalizedError => {
  if (error instanceof Error && error.name === "AbortError") {
    return {
      code: "timeout",
      status: 504,
      message: "Claude request timed out after 30 seconds. Please try again.",
      retryable: true,
    };
  }

  if (error instanceof Anthropic.APIError) {
    const message = error.message || "Claude API returned an error.";
    const status = typeof error.status === "number" ? error.status : 502;

    if (isBillingIssue(message)) {
      return {
        code: "billing",
        status: 402,
        message:
          "Claude API billing/credits issue. Top up credits and retry the request.",
        retryable: false,
      };
    }

    if (status === 429 || status >= 500) {
      return {
        code: "upstream_error",
        status: 502,
        message: `Claude API temporary failure (${status}). Please retry.`,
        retryable: true,
      };
    }

    return {
      code: "bad_request",
      status: 400,
      message: `Claude API rejected request (${status}): ${message}`,
      retryable: false,
    };
  }

  if (error instanceof TypeError) {
    return {
      code: "network",
      status: 502,
      message: `Network error while contacting Claude API: ${error.message}`,
      retryable: true,
    };
  }

  if (error instanceof Error) {
    return {
      code: "upstream_error",
      status: 502,
      message: `Unknown Claude API error: ${error.message}`,
      retryable: false,
    };
  }

  return {
    code: "upstream_error",
    status: 502,
    message: "Unknown error while recognizing painting.",
    retryable: false,
  };
};

export async function POST(request: Request) {
  const requestId = createRequestId(request);
  logStage(requestId, "received", {
    contentLength: request.headers.get("content-length") || "unknown",
    userAgent: request.headers.get("user-agent") || "unknown",
  });

  const body = await parseRequestBody(request);
  const imageBase64 = typeof body?.imageBase64 === "string" ? body.imageBase64.trim() : "";

  if (!imageBase64) {
    logStage(requestId, "validation_failed", {
      reason: "missing_imageBase64",
    });
    return createErrorResponse(
      requestId,
      400,
      "bad_request",
      "imageBase64 is required in request body.",
    );
  }

  const matchedImage = imageBase64.match(IMAGE_DATA_URL_PATTERN);
  if (!matchedImage) {
    logStage(requestId, "validation_failed", {
      reason: "invalid_data_url",
    });
    return createErrorResponse(
      requestId,
      400,
      "bad_request",
      "imageBase64 must be a valid data URL (data:image/jpeg;base64,... or data:image/png;base64,...).",
    );
  }

  const mediaType = normalizeMediaType(matchedImage[1]);
  const encodedImage = matchedImage[2];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "sk-ant-your-key-here") {
    logStage(requestId, "validation_failed", {
      reason: "missing_api_key",
    });
    return createErrorResponse(
      requestId,
      500,
      "bad_request",
      "ANTHROPIC_API_KEY is missing. Add a real key to .env.local and restart dev server.",
    );
  }

  logStage(requestId, "validated", {
    mediaType,
    payloadChars: encodedImage.length,
    model: DEFAULT_MODEL,
  });

  const anthropic = new Anthropic({ apiKey });
  let message: Awaited<ReturnType<typeof anthropic.messages.create>> | null = null;
  let lastError: NormalizedError | null = null;

  try {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const startedAt = Date.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), RECOGNIZE_TIMEOUT_MS);
      logStage(requestId, "claude_call_start", { attempt });

      try {
        message = await anthropic.messages.create(
          {
            model: DEFAULT_MODEL,
            max_tokens: 500,
            temperature: 0.2,
            system: [
              "Ты эксперт-искусствовед.",
              "Проанализируй фото картины.",
              "Игнорируй рамку камеры, браузерный интерфейс, кнопки и фон вокруг произведения.",
              "Сосредоточься на самом изображении картины в кадре.",
              "Верни только валидный JSON без markdown и пояснений.",
              "Формат ответа:",
              '{"painting":"string","artist":"string","year":"string","museum":"string","style":"string","confidence":"high|medium|low","summary":"2-3 предложения на русском"}',
              'Если не уверен, используй значение "unknown" и confidence "low".',
            ].join("\n"),
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: mediaType,
                      data: encodedImage,
                    },
                  },
                  {
                    type: "text",
                    text:
                      "Определи изображение картины в кадре и верни ответ строго как JSON по заданной схеме.",
                  },
                ],
              },
            ],
          },
          { signal: controller.signal },
        );

        logStage(requestId, "claude_call_end", {
          attempt,
          latencyMs: Date.now() - startedAt,
          inputTokens: message.usage?.input_tokens ?? null,
          outputTokens: message.usage?.output_tokens ?? null,
        });
        break;
      } catch (error) {
        const normalizedError = normalizeError(error);
        lastError = normalizedError;
        logStage(requestId, "claude_call_error", {
          attempt,
          code: normalizedError.code,
          status: normalizedError.status,
          retryable: normalizedError.retryable,
          message: normalizedError.message,
        });

        if (attempt === 2 || !normalizedError.retryable) {
          return createErrorResponse(
            requestId,
            normalizedError.status,
            normalizedError.code,
            normalizedError.message,
          );
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }

    if (!message) {
      const unknownError = lastError ?? {
        code: "upstream_error" as const,
        status: 502,
        message: "Claude API call failed with unknown reason.",
      };
      return createErrorResponse(
        requestId,
        unknownError.status,
        unknownError.code,
        unknownError.message,
      );
    }

    const modelText = message.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("\n")
      .trim();

    const extractedJson = extractJson(modelText);
    if (!extractedJson) {
      logStage(requestId, "model_response_fallback", {
        reason: "missing_json",
      });
      return createSuccessResponse(requestId, FALLBACK_RESPONSE);
    }

    try {
      const parsed = JSON.parse(extractedJson) as unknown;
      return createSuccessResponse(requestId, sanitizeResponse(parsed));
    } catch {
      logStage(requestId, "model_response_fallback", {
        reason: "invalid_json",
      });
      return createSuccessResponse(requestId, FALLBACK_RESPONSE);
    }
  } catch (error) {
    const normalizedError = normalizeError(error);
    logStage(requestId, "error", {
      code: normalizedError.code,
      status: normalizedError.status,
      message: normalizedError.message,
    });
    return createErrorResponse(
      requestId,
      normalizedError.status,
      normalizedError.code,
      normalizedError.message,
    );
  }
}
