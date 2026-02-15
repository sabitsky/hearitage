import type {
  EvidenceRecord,
  ProviderOptions,
  ProviderOutput,
} from "@/lib/factcheck/types";

const PROVIDER_NAME = "Art Institute of Chicago";
const PROVIDER_URL = "https://www.artic.edu";

type AicSearchResponse = {
  data?: Array<{
    id?: number;
    title?: string;
    artist_title?: string;
    date_display?: string;
    style_title?: string;
    api_link?: string;
  }>;
};

const getRemainingMs = (deadlineAt: number, perProviderMs: number) => {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) return 0;
  return Math.max(0, Math.min(remaining, perProviderMs));
};

const fetchJsonWithTimeout = async <T>(url: string, timeoutMs: number): Promise<T> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`http_${response.status}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeoutId);
  }
};

const dedupeRecords = (records: EvidenceRecord[]) => {
  const seen = new Set<string>();
  return records.filter((record) => {
    const key = `${record.field}:${record.value.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export async function fetchAicEvidence({
  query,
  deadlineAt,
  providerTimeoutMs,
  tier = "secondary",
}: ProviderOptions): Promise<ProviderOutput> {
  const startedAt = Date.now();
  const timeoutMs = getRemainingMs(deadlineAt, providerTimeoutMs);
  const records: EvidenceRecord[] = [];

  if (timeoutMs < 120) {
    return {
      source: {
        name: PROVIDER_NAME,
        url: PROVIDER_URL,
        tier,
        latencyMs: Date.now() - startedAt,
        ok: false,
        recordCount: 0,
      },
      records,
    };
  }

  const q = [query.painting, query.artist].filter(Boolean).join(" ");
  const searchUrl =
    "https://api.artic.edu/api/v1/artworks/search" +
    `?q=${encodeURIComponent(q)}` +
    "&limit=1" +
    "&fields=id,title,artist_title,date_display,style_title,api_link";

  try {
    const response = await fetchJsonWithTimeout<AicSearchResponse>(searchUrl, timeoutMs);
    const artwork = response.data?.[0];
    const sourceUrl = artwork?.id
      ? `${PROVIDER_URL}/artworks/${artwork.id}`
      : PROVIDER_URL;

    if (artwork?.title) {
      records.push({
        field: "painting",
        value: artwork.title,
        sourceName: PROVIDER_NAME,
        sourceUrl,
        confidence: "medium",
      });
    }

    if (artwork?.artist_title) {
      records.push({
        field: "artist",
        value: artwork.artist_title,
        sourceName: PROVIDER_NAME,
        sourceUrl,
        confidence: "medium",
      });
    }

    if (artwork?.date_display) {
      records.push({
        field: "year",
        value: artwork.date_display,
        sourceName: PROVIDER_NAME,
        sourceUrl,
        confidence: "low",
      });
    }

    if (artwork?.style_title) {
      records.push({
        field: "style",
        value: artwork.style_title,
        sourceName: PROVIDER_NAME,
        sourceUrl,
        confidence: "low",
      });
    }

    if (artwork) {
      records.push({
        field: "museum",
        value: PROVIDER_NAME,
        sourceName: PROVIDER_NAME,
        sourceUrl,
        confidence: "low",
      });
    }
  } catch {
    // Best effort provider.
  }

  const dedupedRecords = dedupeRecords(records);
  return {
    source: {
      name: PROVIDER_NAME,
      url: PROVIDER_URL,
      tier,
      latencyMs: Date.now() - startedAt,
      ok: dedupedRecords.length > 0,
      recordCount: dedupedRecords.length,
    },
    records: dedupedRecords,
  };
}
