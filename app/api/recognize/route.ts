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
const GOOGLE_VISION_MODE = (() => {
  const raw = (process.env.GOOGLE_VISION_MODE || "enrich").trim().toLowerCase();
  if (raw === "off" || raw === "shadow" || raw === "enrich") return raw;
  return "enrich";
})();

const FALLBACK_RESPONSE: Omit<RecognitionResponse, "requestId"> = {
  painting: "Unidentified painting",
  artist: "Unknown artist",
  year: "Unknown",
  museum: "Unknown",
  style: "Unknown",
  confidence: "low",
  reasoning: "Could not analyze the image.",
  summary:
    "Could not identify this painting. Please retake the photo closer to the painting, without glare.",
};

const VISION_SYSTEM_PROMPT = `You are a world-class art historian with encyclopedic knowledge of paintings from ALL eras, styles, regions, and cultures.

TASK: Analyze the photograph of a painting and identify it.

RULES:
- You MUST always provide your best guess. NEVER return "unknown" for painting or artist.
- Even if you are only 10% sure, give your best educated attribution.
- Art historians make educated attributions based on style, technique, period, and composition — do the same.
- Ignore any UI elements, camera frames, buttons, watermarks, or browser chrome in the image. Focus ONLY on the artwork itself.
- If you see text/labels/plaques on or near the painting, use them as additional clues.
- Pay special attention to Russian, Ukrainian, Eastern European, Asian, Latin American, and African art traditions. These artists are world-renowned even if less represented in English sources:
  - Russian: Серебрякова, Кустодиев, Врубель, Малевич, Петров-Водкин, Шагал, Кандинский, Айвазовский, Репин, Суриков, Левитан
  - Ukrainian: Бойчук, Мурашко, Примаченко
  - And many others — do NOT default to Western European or American artists just because they're more familiar

ANALYSIS PROCESS (think step by step in your reasoning):
1. Describe what you see: subject matter, number of figures, composition, dominant colors
2. Identify the artistic technique: brushwork, medium (oil, watercolor, etc.), texture
3. Determine the style/movement: Impressionism, Realism, Baroque, Avant-garde, etc.
4. Narrow down the era: decade or century
5. Based on all clues, identify your top candidate for artist and painting title
6. If you recognize the specific painting, state it with high confidence
7. If not, name the most likely artist based on style, and suggest a probable title

Respond with ONLY valid JSON, no markdown fences, no explanation outside JSON:
{
  "painting": "Title of the painting (original language + English if different)",
  "artist": "Full name of the artist",
  "year": "Year or approximate range (e.g. '1914' or 'c. 1910s')",
  "museum": "Museum where it is housed (or 'Private collection' / 'Unknown')",
  "style": "Artistic movement or style",
  "confidence": "high|medium|low",
  "reasoning": "2-3 sentences explaining WHY you identified it this way — describe what visual features led to your identification",
  "summary": "3-4 engaging sentences about this painting for a museum visitor. Include the most interesting fact."
}`;

type RecognizeRequestBody = {
  imageBase64?: unknown;
};

type NormalizedError = {
  code: RecognitionErrorCode;
  status: number;
  message: string;
  retryable: boolean;
};

type GoogleWebEntity = {
  entityId?: string;
  score: number;
  description: string;
};

type GoogleWebPage = {
  url: string;
  pageTitle?: string;
  fullMatchingImages?: { url: string }[];
  partialMatchingImages?: { url: string }[];
};

type GoogleWebDetection = {
  webEntities?: GoogleWebEntity[];
  fullMatchingImages?: { url: string }[];
  pagesWithMatchingImages?: GoogleWebPage[];
  visuallySimilarImages?: { url: string }[];
  bestGuessLabels?: { label: string }[];
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

const asText = (value: unknown, fallback = "Unknown") => {
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
    reasoning: asText(payload.reasoning),
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

const formatGoogleResultsForPrompt = (webDetection: GoogleWebDetection): string => {
  const parts: string[] = [];

  if (webDetection.webEntities?.length) {
    const topEntities = webDetection.webEntities
      .filter((entity) => entity.description && entity.score > 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((entity) => `"${entity.description}" (confidence: ${entity.score.toFixed(2)})`)
      .join(", ");
    if (topEntities) {
      parts.push(`Web entities: ${topEntities}`);
    }
  }

  if (webDetection.bestGuessLabels?.length) {
    parts.push(`Best guess: ${webDetection.bestGuessLabels.map((label) => label.label).join(", ")}`);
  }

  if (webDetection.pagesWithMatchingImages?.length) {
    const topPages = webDetection.pagesWithMatchingImages
      .slice(0, 5)
      .map((page) => {
        const title = page.pageTitle ? ` ("${page.pageTitle}")` : "";
        return `${page.url}${title}`;
      })
      .join("\n  - ");
    if (topPages) {
      parts.push(`Found on pages:\n  - ${topPages}`);
    }
  }

  if (webDetection.fullMatchingImages?.length) {
    parts.push(
      `Exact image matches found: ${webDetection.fullMatchingImages.length} URLs`,
    );
  }

  return parts.length > 0
    ? parts.join("\n")
    : "No relevant results from reverse image search.";
};

const hasNormalizedError = (
  error: unknown,
): error is {
  normalized: NormalizedError;
} => {
  return (
    typeof error === "object" &&
    error !== null &&
    "normalized" in error &&
    typeof (error as { normalized?: unknown }).normalized === "object" &&
    (error as { normalized?: unknown }).normalized !== null
  );
};

async function googleReverseImageSearch(
  base64ImageData: string,
  requestId: string,
): Promise<GoogleWebDetection | null> {
  const apiKey = process.env.GOOGLE_CLOUD_VISION_KEY;
  if (!apiKey) {
    logStage(requestId, "google_vision_skip", { reason: "no_api_key" });
    return null;
  }

  const startedAt = Date.now();
  logStage(requestId, "google_vision_start");

  try {
    const response = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [
            {
              image: { content: base64ImageData },
              features: [{ type: "WEB_DETECTION", maxResults: 10 }],
            },
          ],
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!response.ok) {
      logStage(requestId, "google_vision_error", {
        status: response.status,
        latencyMs: Date.now() - startedAt,
      });
      return null;
    }

    const data = (await response.json()) as {
      responses?: Array<{ webDetection?: GoogleWebDetection }>;
    };
    const webDetection = data?.responses?.[0]?.webDetection;

    logStage(requestId, "google_vision_end", {
      latencyMs: Date.now() - startedAt,
      entitiesCount: webDetection?.webEntities?.length ?? 0,
      pagesCount: webDetection?.pagesWithMatchingImages?.length ?? 0,
      hasFullMatch: (webDetection?.fullMatchingImages?.length ?? 0) > 0,
      bestGuess: webDetection?.bestGuessLabels?.[0]?.label ?? "none",
    });

    return webDetection ?? null;
  } catch (error) {
    logStage(requestId, "google_vision_error", {
      error: error instanceof Error ? error.message : "unknown",
      latencyMs: Date.now() - startedAt,
    });
    return null;
  }
}

async function mergeResults(
  claudeResult: Omit<RecognitionResponse, "requestId">,
  webDetection: GoogleWebDetection | null,
  requestId: string,
  anthropic: Anthropic,
): Promise<Omit<RecognitionResponse, "requestId">> {
  if (!webDetection || !webDetection.webEntities?.length) {
    logStage(requestId, "merge_skip", { reason: "no_google_results" });
    return claudeResult;
  }

  if (claudeResult.confidence === "high") {
    const topEntity = webDetection.webEntities
      ?.filter((entity) => entity.description && entity.score > 0.5)
      ?.sort((a, b) => b.score - a.score)?.[0];

    if (topEntity) {
      const artistToken = claudeResult.artist.toLowerCase().split(" ").pop() ?? "";
      const googleMentionsArtist =
        artistToken.length > 1 &&
        topEntity.description.toLowerCase().includes(artistToken);
      if (googleMentionsArtist) {
        logStage(requestId, "merge_skip", { reason: "high_confidence_confirmed" });
        return claudeResult;
      }
    }
  }

  const googleFormatted = formatGoogleResultsForPrompt(webDetection);
  logStage(requestId, "merge_start");
  const startedAt = Date.now();

  try {
    const mergeMessage = await anthropic.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 1024,
      temperature: 0.2,
      system: `You are an art identification expert. You must combine two information sources to produce the most accurate painting identification.

CRITICAL RULES:
- Google Reverse Image Search results are VERY reliable for visual matching — if Google found specific artist/painting names with high confidence scores, STRONGLY prefer them
- Your visual analysis provides context about style, technique, and composition
- If Google and visual analysis AGREE → confidence "high"
- If Google found a SPECIFIC painting/artist (score > 0.5) that differs from visual analysis → PREFER Google's identification (it matched actual pixels, not just style)
- If Google is inconclusive (no entities > 0.5, generic labels only) → keep the visual analysis result
- NEVER downgrade a correct identification just because English-language sources are sparse
- Russian, Ukrainian, Asian art may appear with transliterated names in Google results — recognize these
- Always return your response as valid JSON with the same schema`,
      messages: [
        {
          role: "user",
          content: `SOURCE 1 — Visual Analysis by Claude:
${JSON.stringify(claudeResult, null, 2)}

SOURCE 2 — Google Reverse Image Search:
${googleFormatted}

Combine these sources and return the most accurate identification as JSON:
{
  "painting": "Title (original language + English)",
  "artist": "Full name",
  "year": "Year or range",
  "museum": "Museum or 'Unknown'",
  "style": "Movement/style",
  "confidence": "high|medium|low",
  "reasoning": "2-3 sentences explaining your final identification, mentioning which source(s) confirmed it",
  "summary": "3-4 engaging sentences for a museum visitor"
}`,
        },
      ],
    });

    logStage(requestId, "merge_end", {
      latencyMs: Date.now() - startedAt,
      inputTokens: mergeMessage.usage?.input_tokens ?? null,
      outputTokens: mergeMessage.usage?.output_tokens ?? null,
    });

    const mergeText = mergeMessage.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("\n")
      .trim();
    const mergeJson = extractJson(mergeText);
    if (!mergeJson) {
      logStage(requestId, "merge_parse_failed");
      return claudeResult;
    }

    const parsed = JSON.parse(mergeJson) as unknown;
    return sanitizeResponse(parsed);
  } catch (error) {
    logStage(requestId, "merge_error", {
      error: error instanceof Error ? error.message : "unknown",
      latencyMs: Date.now() - startedAt,
    });
    return claudeResult;
  }
}

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
    googleVisionMode: GOOGLE_VISION_MODE,
  });

  const anthropic = new Anthropic({ apiKey });
  logStage(requestId, "pipeline_start");

  try {
    const claudePromise = (async (): Promise<Omit<RecognitionResponse, "requestId"> | null> => {
      const startedAt = Date.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), RECOGNIZE_TIMEOUT_MS);
      logStage(requestId, "claude_call_start");

      try {
        const message = await anthropic.messages.create(
          {
            model: DEFAULT_MODEL,
            max_tokens: 1024,
            temperature: 0.3,
            system: VISION_SYSTEM_PROMPT,
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
                    text: "Identify this painting. Return ONLY valid JSON.",
                  },
                ],
              },
            ],
          },
          { signal: controller.signal },
        );

        logStage(requestId, "claude_call_end", {
          latencyMs: Date.now() - startedAt,
          inputTokens: message.usage?.input_tokens ?? null,
          outputTokens: message.usage?.output_tokens ?? null,
        });

        const modelText = message.content
          .map((block) => (block.type === "text" ? block.text : ""))
          .join("\n")
          .trim();
        const jsonStr = extractJson(modelText);
        if (!jsonStr) {
          logStage(requestId, "claude_parse_failed", { rawLength: modelText.length });
          return null;
        }
        return sanitizeResponse(JSON.parse(jsonStr));
      } catch (error) {
        const normalizedError = normalizeError(error);
        logStage(requestId, "claude_call_error", {
          code: normalizedError.code,
          message: normalizedError.message,
          latencyMs: Date.now() - startedAt,
        });

        if (!normalizedError.retryable) {
          throw { normalized: normalizedError };
        }

        try {
          logStage(requestId, "claude_retry_start");
          const retryMessage = await anthropic.messages.create(
            {
              model: DEFAULT_MODEL,
              max_tokens: 1024,
              temperature: 0.3,
              system: VISION_SYSTEM_PROMPT,
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
                      text: "Identify this painting. Return ONLY valid JSON.",
                    },
                  ],
                },
              ],
            },
            { signal: AbortSignal.timeout(RECOGNIZE_TIMEOUT_MS) },
          );

          const retryText = retryMessage.content
            .map((block) => (block.type === "text" ? block.text : ""))
            .join("\n")
            .trim();
          const retryJson = extractJson(retryText);
          logStage(requestId, "claude_retry_end");
          if (!retryJson) {
            return null;
          }
          return sanitizeResponse(JSON.parse(retryJson));
        } catch {
          throw { normalized: normalizedError };
        }
      } finally {
        clearTimeout(timeoutId);
      }
    })();

    const googlePromise =
      GOOGLE_VISION_MODE !== "off"
        ? googleReverseImageSearch(encodedImage, requestId)
        : Promise.resolve(null);

    let claudeResult: Omit<RecognitionResponse, "requestId"> | null;
    let googleResult: GoogleWebDetection | null;

    try {
      [claudeResult, googleResult] = await Promise.all([claudePromise, googlePromise]);
    } catch (error: unknown) {
      if (hasNormalizedError(error)) {
        const { normalized } = error;
        return createErrorResponse(
          requestId,
          normalized.status,
          normalized.code,
          normalized.message,
        );
      }
      return createErrorResponse(
        requestId,
        502,
        "upstream_error",
        "Unknown pipeline error.",
      );
    }

    if (!claudeResult) {
      return createErrorResponse(
        requestId,
        502,
        "non_json_response",
        "Claude returned unparseable response. Please retake the photo and try again.",
      );
    }

    if (GOOGLE_VISION_MODE === "shadow") {
      logStage(requestId, "google_vision_shadow", {
        googleEntities: googleResult?.webEntities?.slice(0, 3) ?? [],
        googleBestGuess: googleResult?.bestGuessLabels?.[0]?.label ?? "none",
        claudeArtist: claudeResult.artist,
        claudePainting: claudeResult.painting,
      });
      logStage(requestId, "pipeline_end", {
        finalConfidence: claudeResult.confidence,
        hadGoogleResults: googleResult !== null,
        claudeArtist: claudeResult.artist,
        finalArtist: claudeResult.artist,
        changed: false,
      });
      return createSuccessResponse(requestId, claudeResult);
    }

    const finalResult = await mergeResults(claudeResult, googleResult, requestId, anthropic);

    logStage(requestId, "pipeline_end", {
      finalConfidence: finalResult.confidence,
      hadGoogleResults: googleResult !== null,
      claudeArtist: claudeResult.artist,
      finalArtist: finalResult.artist,
      changed: claudeResult.artist !== finalResult.artist,
    });

    return createSuccessResponse(requestId, finalResult);
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
