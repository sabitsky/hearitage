import type {
  EvidenceRecord,
  ProviderOptions,
  ProviderOutput,
} from "@/lib/factcheck/types";

const PROVIDER_NAME = "Cleveland Museum of Art";
const PROVIDER_URL = "https://www.clevelandart.org";

type CmaSearchResponse = {
  data?: Array<{
    id?: number;
    title?: string;
    creation_date?: string;
    technique?: string;
    culture?: string;
    creators?: Array<{
      description?: string;
    }>;
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

export async function fetchCmaEvidence({
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
    "https://openaccess-api.clevelandart.org/api/artworks/" +
    `?q=${encodeURIComponent(q)}&limit=1`;

  try {
    const response = await fetchJsonWithTimeout<CmaSearchResponse>(searchUrl, timeoutMs);
    const artwork = response.data?.[0];
    const sourceUrl = artwork?.id
      ? `${PROVIDER_URL}/art/${artwork.id}`
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

    const creator = artwork?.creators?.[0]?.description;
    if (creator) {
      records.push({
        field: "artist",
        value: creator,
        sourceName: PROVIDER_NAME,
        sourceUrl,
        confidence: "medium",
      });
    }

    if (artwork?.creation_date) {
      records.push({
        field: "year",
        value: artwork.creation_date,
        sourceName: PROVIDER_NAME,
        sourceUrl,
        confidence: "low",
      });
    }

    if (artwork?.technique) {
      records.push({
        field: "style",
        value: artwork.technique,
        sourceName: PROVIDER_NAME,
        sourceUrl,
        confidence: "low",
      });
    } else if (artwork?.culture) {
      records.push({
        field: "style",
        value: artwork.culture,
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
