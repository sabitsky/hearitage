import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import type { RecognitionConfidence, RecognitionResponse } from "@/lib/types";

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
const IMAGE_DATA_URL_PATTERN =
  /^data:(image\/(?:jpeg|jpg|png|gif|webp));base64,([A-Za-z0-9+/=]+)$/;

const FALLBACK_RESPONSE: RecognitionResponse = {
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

const sanitizeResponse = (raw: unknown): RecognitionResponse => {
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

export async function POST(request: Request) {
  const body = await parseRequestBody(request);
  const imageBase64 = typeof body?.imageBase64 === "string" ? body.imageBase64.trim() : "";

  if (!imageBase64) {
    return NextResponse.json(
      { error: "imageBase64 is required in request body." },
      { status: 400 },
    );
  }

  const matchedImage = imageBase64.match(IMAGE_DATA_URL_PATTERN);
  if (!matchedImage) {
    return NextResponse.json(
      {
        error:
          "imageBase64 must be a valid data URL (data:image/jpeg;base64,... or data:image/png;base64,...).",
      },
      { status: 400 },
    );
  }

  const mediaType = normalizeMediaType(matchedImage[1]);
  const encodedImage = matchedImage[2];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "sk-ant-your-key-here") {
    return NextResponse.json(
      {
        error:
          "ANTHROPIC_API_KEY is missing. Add a real key to .env.local and restart dev server.",
      },
      { status: 500 },
    );
  }

  const anthropic = new Anthropic({ apiKey });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  try {
    const message = await anthropic.messages.create(
      {
        model: DEFAULT_MODEL,
        max_tokens: 500,
        temperature: 0.2,
        system: [
          "Ты эксперт-искусствовед.",
          "Проанализируй фото картины.",
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
                text: "Определи картину по фото и верни ответ строго как JSON.",
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
      return NextResponse.json(FALLBACK_RESPONSE);
    }

    try {
      const parsed = JSON.parse(extractedJson) as unknown;
      return NextResponse.json(sanitizeResponse(parsed));
    } catch {
      return NextResponse.json(FALLBACK_RESPONSE);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json(
        { error: "Claude request timed out after 30 seconds. Please try again." },
        { status: 504 },
      );
    }

    if (error instanceof Error) {
      return NextResponse.json(
        { error: `Claude API request failed: ${error.message}` },
        { status: 502 },
      );
    }

    return NextResponse.json(
      { error: "Unknown error while recognizing painting." },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
