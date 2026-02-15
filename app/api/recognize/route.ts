import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { fetchEvidenceBundle } from "@/lib/factcheck/orchestrator";
import type { FactCheckInput, FactsDraft } from "@/lib/factcheck/types";
import { validateAndMerge } from "@/lib/factcheck/validator";
import type {
  RecognitionConfidence,
  RecognitionErrorCode,
  RecognitionErrorResponse,
  RecognitionFactCheck,
  RecognitionFactCheckStatus,
  RecognitionResponse,
} from "@/lib/types";

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
const IMAGE_DATA_URL_PATTERN =
  /^data:(image\/(?:jpeg|jpg|png|gif|webp));base64,([A-Za-z0-9+/=]+)$/;
const RECOGNIZE_TIMEOUT_MS = 30_000;
const MAX_RETRY_ATTEMPTS = 2;
const MODEL_MAX_TOKENS = 1024;
const MODEL_TEMPERATURE = 0.3;

type FactCheckMode = "off" | "shadow" | "enrich";

const parseFactCheckMode = (value: string | undefined): FactCheckMode => {
  if (value === "off" || value === "shadow" || value === "enrich") {
    return value;
  }
  return "shadow";
};

const FACTCHECK_MODE = parseFactCheckMode(process.env.FACTCHECK_MODE);
const FACTCHECK_BUDGET_MS = Number(process.env.FACTCHECK_BUDGET_MS || 1800);
const FACTCHECK_PROVIDER_TIMEOUT_MS = Number(
  process.env.FACTCHECK_PROVIDER_TIMEOUT_MS || 800,
);
const FACTCHECK_CLAUDE_TIMEOUT_MS = Number(
  process.env.FACTCHECK_CLAUDE_TIMEOUT_MS || 1200,
);
const FACTCHECK_MAX_FACTS = Number(process.env.FACTCHECK_MAX_FACTS || 3);
const FACTCHECK_PHASE_A_BUDGET_MS = Number(process.env.FACTCHECK_PHASE_A_BUDGET_MS || 900);
const FACTCHECK_RESPONSE_BUFFER_MS = Number(
  process.env.FACTCHECK_RESPONSE_BUFFER_MS || 200,
);
const FACTCHECK_CACHE_TTL_MS = Number(
  process.env.FACTCHECK_CACHE_TTL_MS || 6 * 60 * 60 * 1000,
);

const PRIMARY_SYSTEM_PROMPT = [
  "You are a world-class art historian with encyclopedic knowledge of paintings across eras, styles, and regions.",
  "Analyze the photographed artwork and identify it.",
  "Always provide your best guess. Never leave painting or artist empty.",
  "Ignore camera frames, browser UI, buttons, watermarks, and any non-artwork overlays.",
  "You may use visible text in the image as supporting evidence.",
  "Respond with valid JSON only. No markdown fences. No extra commentary.",
  "JSON schema:",
  '{"painting":"string","artist":"string","year":"string","museum":"string","style":"string","confidence":"high|medium|low","reasoning":"2-3 English sentences","summary":"3-4 English sentences for a museum visitor"}',
].join("\n");

const PRIMARY_USER_PROMPT = [
  "Identify the painting in this image.",
  "Focus on the artwork itself, not the surrounding interface.",
  "Return only valid JSON using the required schema.",
].join(" ");

const FACTS_DRAFT_SYSTEM_PROMPT = [
  "You are an art historian creating concise museum-friendly facts.",
  "Use only broadly accepted facts and avoid speculative claims.",
  "Return valid JSON only with no markdown fences.",
  "JSON schema:",
  '{"facts":["string","string","string"],"summaryAddon":"string"}',
].join("\n");

const ANALYSIS_FAILURE_MESSAGE =
  "Could not analyze image reliably. Retake closer and retry.";
const REASONING_FALLBACK_TEXT =
  "Visual evidence is limited, so this attribution is tentative.";
const SUMMARY_FALLBACK_TEXT =
  "This painting appears to match the identified artist and period based on composition and style cues.";

type RecognizeRequestBody = {
  imageBase64?: unknown;
};

type NormalizedError = {
  code: RecognitionErrorCode;
  status: number;
  message: string;
  retryable: boolean;
};

type RecognitionCorePayload = {
  painting: string;
  artist: string;
  year: string;
  museum: string;
  style: string;
  confidence: RecognitionConfidence;
  reasoning: string;
  summary: string;
};

type RecognitionSuccessPayload = Omit<RecognitionResponse, "requestId">;
type RecognitionPass = "primary" | "retry";

type PassResult =
  | {
      ok: true;
      payload: RecognitionCorePayload;
    }
  | {
      ok: false;
      error: NormalizedError;
    };

type RunRecognitionPassParams = {
  anthropic: Anthropic;
  requestId: string;
  pass: RecognitionPass;
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  encodedImage: string;
  userPrompt: string;
};

type CachedFactCheckValue = {
  summary: string;
  facts: string[];
  factCheck: RecognitionFactCheck;
};

const globalFactCheckState = globalThis as typeof globalThis & {
  __hearitageFactcheckCache?: Map<
    string,
    { expiresAt: number; value: CachedFactCheckValue }
  >;
};

if (!globalFactCheckState.__hearitageFactcheckCache) {
  globalFactCheckState.__hearitageFactcheckCache = new Map();
}

const factCheckCache = globalFactCheckState.__hearitageFactcheckCache;

const asPositiveInt = (value: number, fallback: number) => {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.round(value);
};

const normalizedFactCheckBudgetMs = asPositiveInt(FACTCHECK_BUDGET_MS, 1800);
const normalizedProviderTimeoutMs = asPositiveInt(FACTCHECK_PROVIDER_TIMEOUT_MS, 800);
const normalizedFactCheckClaudeTimeoutMs = asPositiveInt(
  FACTCHECK_CLAUDE_TIMEOUT_MS,
  1200,
);
const normalizedFactCheckMaxFacts = Math.min(
  Math.max(asPositiveInt(FACTCHECK_MAX_FACTS, 3), 1),
  5,
);
const normalizedFactCheckPhaseABudgetMs = asPositiveInt(
  FACTCHECK_PHASE_A_BUDGET_MS,
  900,
);
const normalizedFactCheckResponseBufferMs = asPositiveInt(
  FACTCHECK_RESPONSE_BUFFER_MS,
  200,
);
const normalizedFactCheckCacheTtlMs = asPositiveInt(
  FACTCHECK_CACHE_TTL_MS,
  6 * 60 * 60 * 1000,
);

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

const asText = (value: unknown, fallback = "unknown") => {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

const asNarrativeText = (value: unknown, fallback: string) => {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

const asConfidence = (value: unknown): RecognitionConfidence => {
  if (typeof value !== "string") return "low";
  const normalized = value.trim().toLowerCase();
  if (normalized === "high" || normalized === "medium" || normalized === "low") {
    return normalized;
  }
  return "low";
};

const sanitizeResponse = (raw: unknown): RecognitionCorePayload | null => {
  if (!raw || typeof raw !== "object") return null;
  const payload = raw as Record<string, unknown>;

  return {
    painting: asText(payload.painting),
    artist: asText(payload.artist),
    year: asText(payload.year),
    museum: asText(payload.museum),
    style: asText(payload.style),
    confidence: asConfidence(payload.confidence),
    reasoning: asNarrativeText(payload.reasoning, REASONING_FALLBACK_TEXT),
    summary: asNarrativeText(payload.summary, SUMMARY_FALLBACK_TEXT),
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
  payload: RecognitionSuccessPayload,
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

const createAnalysisFailureError = (retryable: boolean): NormalizedError => ({
  code: "upstream_error",
  status: 502,
  message: ANALYSIS_FAILURE_MESSAGE,
  retryable,
});

const buildRetryUserPrompt = (result: RecognitionCorePayload) => {
  return [
    "A first-pass analysis suggested:",
    `- Painting: ${result.painting}`,
    `- Artist: ${result.artist}`,
    `- Style: ${result.style}`,
    `- Year/Era: ${result.year}`,
    `- Reasoning: ${result.reasoning}`,
    "Re-check the image carefully and provide a refined attribution.",
    "Commit to your best guess and return only valid JSON in the same schema.",
  ].join("\n");
};

const buildFactsDraftUserPrompt = (payload: RecognitionCorePayload) =>
  [
    "You already identified this painting as:",
    `Painting: ${payload.painting}`,
    `Artist: ${payload.artist}`,
    `Year: ${payload.year}`,
    `Museum: ${payload.museum}`,
    `Style: ${payload.style}`,
    `Confidence: ${payload.confidence}`,
    `Current summary: ${payload.summary}`,
    "Provide 2-3 concise interesting facts and one additional summary sentence.",
    "Do not repeat the same sentence from current summary.",
    "Return only valid JSON in the required schema.",
  ].join("\n");

const makeFactCheckMeta = (
  status: RecognitionFactCheckStatus,
  latencyMs: number,
): RecognitionFactCheck => ({
  status,
  verifiedFacts: 0,
  sources: [],
  latencyMs,
});

const isUnknownValue = (value: string) => value.trim().toLowerCase() === "unknown";

const shouldRunRetryPass = (result: RecognitionCorePayload) =>
  result.confidence === "low" ||
  isUnknownValue(result.painting) ||
  isUnknownValue(result.artist);

const shouldRunFactCheckForCoreResult = (result: RecognitionCorePayload) =>
  FACTCHECK_MODE !== "off" &&
  result.confidence !== "low" &&
  !isUnknownValue(result.painting) &&
  !isUnknownValue(result.artist);

const sanitizeFactsDraft = (raw: unknown): FactsDraft | null => {
  if (!raw || typeof raw !== "object") return null;
  const payload = raw as Record<string, unknown>;
  const factsRaw = Array.isArray(payload.facts) ? payload.facts : [];
  const facts = factsRaw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, normalizedFactCheckMaxFacts + 1);

  const summaryAddon =
    typeof payload.summaryAddon === "string" ? payload.summaryAddon.trim() : "";

  if (facts.length === 0 && summaryAddon.length === 0) {
    return null;
  }

  return {
    facts,
    summaryAddon,
  };
};

const normalizeCacheKey = (painting: string, artist: string) =>
  `${painting}|${artist}`
    .toLowerCase()
    .replace(/[^a-z0-9а-яё| ]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

const getFactCheckCacheValue = (key: string): CachedFactCheckValue | null => {
  const hit = factCheckCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    factCheckCache.delete(key);
    return null;
  }
  return hit.value;
};

const setFactCheckCacheValue = (key: string, value: CachedFactCheckValue) => {
  if (!key) return;
  factCheckCache.set(key, {
    expiresAt: Date.now() + normalizedFactCheckCacheTtlMs,
    value,
  });
};

const generateFactsDraftWithClaude = async ({
  anthropic,
  requestId,
  payload,
  timeoutMs,
}: {
  anthropic: Anthropic;
  requestId: string;
  payload: RecognitionCorePayload;
  timeoutMs: number;
}): Promise<FactsDraft | null> => {
  const safeTimeoutMs = Math.max(200, timeoutMs);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), safeTimeoutMs);
  const startedAt = Date.now();

  logStage(requestId, "facts_draft_start", {
    timeoutMs: safeTimeoutMs,
  });

  try {
    const message = await anthropic.messages.create(
      {
        model: DEFAULT_MODEL,
        max_tokens: 220,
        temperature: 0.2,
        system: FACTS_DRAFT_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: buildFactsDraftUserPrompt(payload),
              },
            ],
          },
        ],
      },
      { signal: controller.signal },
    );

    const modelText = message.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("\n")
      .trim();

    const extractedJson = extractJson(modelText);
    if (!extractedJson) {
      logStage(requestId, "facts_draft_error", {
        reason: "missing_json",
        latencyMs: Date.now() - startedAt,
      });
      return null;
    }

    const parsed = JSON.parse(extractedJson) as unknown;
    const draft = sanitizeFactsDraft(parsed);

    logStage(requestId, "facts_draft_end", {
      latencyMs: Date.now() - startedAt,
      facts: draft?.facts.length ?? 0,
      hasSummaryAddon: Boolean(draft?.summaryAddon),
    });
    return draft;
  } catch (error) {
    const normalizedError = normalizeError(error);
    logStage(requestId, "facts_draft_error", {
      code: normalizedError.code,
      status: normalizedError.status,
      message: normalizedError.message,
      latencyMs: Date.now() - startedAt,
    });
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};

const runRecognitionPass = async ({
  anthropic,
  requestId,
  pass,
  mediaType,
  encodedImage,
  userPrompt,
}: RunRecognitionPassParams): Promise<PassResult> => {
  let lastError: NormalizedError | null = null;

  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), RECOGNIZE_TIMEOUT_MS);

    logStage(requestId, "claude_call_start", { pass, attempt });

    try {
      const message = await anthropic.messages.create(
        {
          model: DEFAULT_MODEL,
          max_tokens: MODEL_MAX_TOKENS,
          temperature: MODEL_TEMPERATURE,
          system: PRIMARY_SYSTEM_PROMPT,
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
                  text: userPrompt,
                },
              ],
            },
          ],
        },
        { signal: controller.signal },
      );

      logStage(requestId, "claude_call_end", {
        pass,
        attempt,
        latencyMs: Date.now() - startedAt,
        inputTokens: message.usage?.input_tokens ?? null,
        outputTokens: message.usage?.output_tokens ?? null,
      });

      const modelText = message.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("\n")
        .trim();

      const extractedJson = extractJson(modelText);
      if (!extractedJson) {
        lastError = createAnalysisFailureError(attempt < MAX_RETRY_ATTEMPTS);
        logStage(requestId, "claude_parse_error", {
          pass,
          attempt,
          reason: "missing_json",
        });
        if (attempt === MAX_RETRY_ATTEMPTS) {
          return { ok: false, error: createAnalysisFailureError(false) };
        }
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(extractedJson) as unknown;
      } catch {
        lastError = createAnalysisFailureError(attempt < MAX_RETRY_ATTEMPTS);
        logStage(requestId, "claude_parse_error", {
          pass,
          attempt,
          reason: "invalid_json",
        });
        if (attempt === MAX_RETRY_ATTEMPTS) {
          return { ok: false, error: createAnalysisFailureError(false) };
        }
        continue;
      }

      const sanitized = sanitizeResponse(parsed);
      if (!sanitized) {
        lastError = createAnalysisFailureError(attempt < MAX_RETRY_ATTEMPTS);
        logStage(requestId, "claude_parse_error", {
          pass,
          attempt,
          reason: "invalid_payload_shape",
        });
        if (attempt === MAX_RETRY_ATTEMPTS) {
          return { ok: false, error: createAnalysisFailureError(false) };
        }
        continue;
      }

      return {
        ok: true,
        payload: sanitized,
      };
    } catch (error) {
      const normalizedError = normalizeError(error);
      lastError = normalizedError;
      logStage(requestId, "claude_call_error", {
        pass,
        attempt,
        code: normalizedError.code,
        status: normalizedError.status,
        retryable: normalizedError.retryable,
        message: normalizedError.message,
      });

      if (attempt === MAX_RETRY_ATTEMPTS || !normalizedError.retryable) {
        return { ok: false, error: normalizedError };
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return {
    ok: false,
    error: lastError ?? createAnalysisFailureError(false),
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
      "misconfigured_env",
      "Server misconfiguration: set ANTHROPIC_API_KEY in deployment environment variables.",
    );
  }

  logStage(requestId, "validated", {
    mediaType,
    payloadChars: encodedImage.length,
    model: DEFAULT_MODEL,
    factcheck_mode: FACTCHECK_MODE,
    factcheck_budget_ms: normalizedFactCheckBudgetMs,
  });

  const anthropic = new Anthropic({ apiKey });

  try {
    const primaryResult = await runRecognitionPass({
      anthropic,
      requestId,
      pass: "primary",
      mediaType,
      encodedImage,
      userPrompt: PRIMARY_USER_PROMPT,
    });

    if (!primaryResult.ok) {
      return createErrorResponse(
        requestId,
        primaryResult.error.status,
        primaryResult.error.code,
        primaryResult.error.message,
      );
    }

    let finalPayload = primaryResult.payload;

    if (shouldRunRetryPass(primaryResult.payload)) {
      logStage(requestId, "retry_decision", {
        reason: "low_confidence_or_unknown",
        confidence: primaryResult.payload.confidence,
        painting: primaryResult.payload.painting,
        artist: primaryResult.payload.artist,
      });

      const retryResult = await runRecognitionPass({
        anthropic,
        requestId,
        pass: "retry",
        mediaType,
        encodedImage,
        userPrompt: buildRetryUserPrompt(primaryResult.payload),
      });

      if (retryResult.ok) {
        finalPayload = retryResult.payload;
      } else {
        logStage(requestId, "retry_failed", {
          code: retryResult.error.code,
          status: retryResult.error.status,
          message: retryResult.error.message,
        });
      }
    }

    if (isUnknownValue(finalPayload.painting) && isUnknownValue(finalPayload.artist)) {
      logStage(requestId, "analysis_failed", {
        reason: "unknown_after_passes",
      });
      return createErrorResponse(
        requestId,
        502,
        "upstream_error",
        ANALYSIS_FAILURE_MESSAGE,
      );
    }

    const factCheckStartedAt = Date.now();
    let successPayload: RecognitionSuccessPayload = {
      ...finalPayload,
      facts: [],
      factCheck: makeFactCheckMeta("skipped_no_evidence", 0),
    };

    logStage(requestId, "factcheck_mode", {
      factcheck_mode: FACTCHECK_MODE,
    });

    if (!shouldRunFactCheckForCoreResult(finalPayload)) {
      const latencyMs = Date.now() - factCheckStartedAt;
      const status: RecognitionFactCheckStatus = "skipped_no_evidence";
      successPayload = {
        ...finalPayload,
        facts: [],
        factCheck: makeFactCheckMeta(status, latencyMs),
      };
      logStage(requestId, "factcheck_final", {
        factcheck_mode: FACTCHECK_MODE,
        evidence_coverage_score: 0,
        sources_used: [],
        factcheck_latency_ms: latencyMs,
        factcheck_applied: false,
        final_status: status,
      });
      return createSuccessResponse(requestId, successPayload);
    }

    const cacheKey = normalizeCacheKey(finalPayload.painting, finalPayload.artist);
    const cacheHit = getFactCheckCacheValue(cacheKey);

    if (cacheHit) {
      const latencyMs = Date.now() - factCheckStartedAt;
      const applied = FACTCHECK_MODE === "enrich";
      successPayload = applied
        ? {
            ...finalPayload,
            summary: cacheHit.summary,
            facts: cacheHit.facts,
            factCheck: {
              ...cacheHit.factCheck,
              latencyMs,
            },
          }
        : {
            ...finalPayload,
            facts: [],
            factCheck: {
              ...cacheHit.factCheck,
              latencyMs,
            },
          };

      logStage(requestId, "factcheck_cache_hit", {
        cacheKey,
        factcheck_mode: FACTCHECK_MODE,
        factcheck_applied: applied,
      });

      logStage(requestId, "factcheck_final", {
        factcheck_mode: FACTCHECK_MODE,
        evidence_coverage_score: null,
        sources_used: successPayload.factCheck.sources,
        factcheck_latency_ms: latencyMs,
        factcheck_applied: applied,
        final_status: successPayload.factCheck.status,
      });

      return createSuccessResponse(requestId, successPayload);
    }

    try {
      const factCheckInput: FactCheckInput = {
        painting: finalPayload.painting,
        artist: finalPayload.artist,
        year: finalPayload.year,
        museum: finalPayload.museum,
        style: finalPayload.style,
        summary: finalPayload.summary,
        confidence: finalPayload.confidence,
      };

      const evidence = await fetchEvidenceBundle({
        query: factCheckInput,
        budgetMs: normalizedFactCheckBudgetMs,
        providerTimeoutMs: normalizedProviderTimeoutMs,
        phaseABudgetMs: normalizedFactCheckPhaseABudgetMs,
        responseBufferMs: normalizedFactCheckResponseBufferMs,
        logger: (stage, details = {}) => logStage(requestId, stage, details),
      });

      const elapsedMs = Date.now() - factCheckStartedAt;
      if (elapsedMs >= normalizedFactCheckBudgetMs) {
        const status: RecognitionFactCheckStatus = "skipped_timeout";
        successPayload = {
          ...finalPayload,
          facts: [],
          factCheck: makeFactCheckMeta(status, elapsedMs),
        };

        logStage(requestId, "factcheck_timeout", {
          reason: "budget_exhausted_after_evidence",
          factcheck_mode: FACTCHECK_MODE,
          evidence_coverage_score: evidence.coverageScore,
          primary_coverage_score: evidence.primaryCoverageScore,
          factcheck_latency_ms: elapsedMs,
        });

        logStage(requestId, "factcheck_final", {
          factcheck_mode: FACTCHECK_MODE,
          evidence_coverage_score: evidence.coverageScore,
          primary_coverage_score: evidence.primaryCoverageScore,
          sources_used: [],
          factcheck_latency_ms: elapsedMs,
          factcheck_applied: false,
          final_status: status,
        });
        return createSuccessResponse(requestId, successPayload);
      }
      const remainingMsForDraft = Math.max(
        0,
        normalizedFactCheckBudgetMs - elapsedMs - normalizedFactCheckResponseBufferMs,
      );
      const hasEnoughPrimaryEvidence = evidence.primaryCoverageScore >= 2;
      let draft: FactsDraft | null = null;

      if (
        hasEnoughPrimaryEvidence &&
        remainingMsForDraft >= 260 &&
        FACTCHECK_MODE !== "off"
      ) {
        draft = await generateFactsDraftWithClaude({
          anthropic,
          requestId,
          payload: finalPayload,
          timeoutMs: Math.min(
            normalizedFactCheckClaudeTimeoutMs,
            remainingMsForDraft,
          ),
        });
      } else {
        logStage(requestId, "facts_draft_skipped", {
          hasEnoughPrimaryEvidence,
          remainingMsForDraft,
        });
      }

      const factCheckLatencyMs = Date.now() - factCheckStartedAt;
      const timedOut =
        evidence.timedOut || factCheckLatencyMs > normalizedFactCheckBudgetMs;
      const merged = validateAndMerge({
        base: factCheckInput,
        draft,
        evidence,
        maxFacts: normalizedFactCheckMaxFacts,
        latencyMs: factCheckLatencyMs,
        timedOut,
      });

      logStage(requestId, "factcheck_validate_end", {
        candidateFacts: merged.diagnostics.candidateFacts.length,
        verifiedFacts: merged.diagnostics.verifiedFacts.length,
        keptSummaryAddonSentences: merged.diagnostics.keptSummaryAddonSentences,
        droppedSummaryAddonSentences:
          merged.diagnostics.droppedSummaryAddonSentences,
        evidence_coverage_score: merged.diagnostics.evidenceCoverageScore,
      });

      if (FACTCHECK_MODE === "shadow") {
        logStage(requestId, "factcheck_shadow_candidate", {
          candidate_facts: merged.diagnostics.candidateFacts.slice(0, 3),
          verified_facts: merged.facts,
          summary_addon_applied_sentences:
            merged.diagnostics.keptSummaryAddonSentences,
        });
      }

      const applied = FACTCHECK_MODE === "enrich";
      successPayload = applied
        ? {
            ...finalPayload,
            summary: merged.summary,
            facts: merged.facts,
            factCheck: merged.factCheck,
          }
        : {
            ...finalPayload,
            facts: [],
            factCheck: merged.factCheck,
          };

      setFactCheckCacheValue(cacheKey, {
        summary: merged.summary,
        facts: merged.facts,
        factCheck: merged.factCheck,
      });

      logStage(requestId, "factcheck_diff_impact", {
        core_fields_unchanged:
          successPayload.painting === finalPayload.painting &&
          successPayload.artist === finalPayload.artist &&
          successPayload.year === finalPayload.year &&
          successPayload.museum === finalPayload.museum &&
          successPayload.style === finalPayload.style &&
          successPayload.confidence === finalPayload.confidence &&
          successPayload.reasoning === finalPayload.reasoning,
      });

      logStage(requestId, "factcheck_final", {
        factcheck_mode: FACTCHECK_MODE,
        evidence_coverage_score: evidence.coverageScore,
        primary_coverage_score: evidence.primaryCoverageScore,
        sources_used: successPayload.factCheck.sources,
        factcheck_latency_ms: successPayload.factCheck.latencyMs,
        factcheck_applied: applied,
        final_status: successPayload.factCheck.status,
      });
    } catch (error) {
      const latencyMs = Date.now() - factCheckStartedAt;
      logStage(requestId, "factcheck_error", {
        message: error instanceof Error ? error.message : "unknown",
        latencyMs,
      });

      const status: RecognitionFactCheckStatus =
        latencyMs > normalizedFactCheckBudgetMs
          ? "skipped_timeout"
          : "skipped_no_evidence";
      successPayload = {
        ...finalPayload,
        facts: [],
        factCheck: makeFactCheckMeta(status, latencyMs),
      };

      logStage(requestId, "factcheck_final", {
        factcheck_mode: FACTCHECK_MODE,
        evidence_coverage_score: 0,
        sources_used: [],
        factcheck_latency_ms: latencyMs,
        factcheck_applied: false,
        final_status: status,
      });
    }

    return createSuccessResponse(requestId, successPayload);
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
