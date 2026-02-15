import type {
  EvidenceRecord,
  ProviderOptions,
  ProviderOutput,
} from "@/lib/factcheck/types";

const PROVIDER_NAME = "Wikimedia";
const PROVIDER_URL = "https://www.wikipedia.org";
const WIKIMEDIA_LANGUAGES = ["en", "ru"] as const;

type WikipediaSearchResponse = {
  query?: {
    search?: Array<{
      title?: string;
    }>;
  };
};

type WikipediaSummary = {
  title?: string;
  description?: string;
  extract?: string;
  content_urls?: {
    desktop?: {
      page?: string;
    };
  };
  wikibase_item?: string;
  type?: string;
};

type WikidataEntity = {
  claims?: Record<string, unknown>;
  labels?: Record<string, { value?: string }>;
  aliases?: Record<string, Array<{ value?: string }>>;
};

type WikidataEntitiesResponse = {
  entities?: Record<string, WikidataEntity>;
};

const normalize = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9а-яё\s]/gi, " ").replace(/\s+/g, " ").trim();

const includesIgnoreCase = (haystack: string, needle: string) => {
  const normalizedNeedle = normalize(needle);
  if (!normalizedNeedle) return false;
  return normalize(haystack).includes(normalizedNeedle);
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
    if (response.status === 404) {
      throw new Error("not_found");
    }
    if (!response.ok) {
      throw new Error(`http_${response.status}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeoutId);
  }
};

const parseWikidataYear = (value: unknown) => {
  if (!value || typeof value !== "object") return null;
  const obj = value as { time?: unknown };
  if (typeof obj.time !== "string") return null;
  const matches = obj.time.match(/([0-9]{4})-/);
  return matches?.[1] ?? null;
};

const toEntityId = (value: unknown) => {
  if (!value || typeof value !== "object") return null;
  const obj = value as { id?: unknown };
  return typeof obj.id === "string" ? obj.id : null;
};

const getClaimValue = (claims: Record<string, unknown>, key: string): unknown => {
  const claimList = claims[key];
  if (!Array.isArray(claimList) || claimList.length === 0) return null;
  const claim = claimList[0];
  if (!claim || typeof claim !== "object") return null;
  const mainsnak = (claim as { mainsnak?: unknown }).mainsnak;
  if (!mainsnak || typeof mainsnak !== "object") return null;
  const datavalue = (mainsnak as { datavalue?: unknown }).datavalue;
  if (!datavalue || typeof datavalue !== "object") return null;
  return (datavalue as { value?: unknown }).value ?? null;
};

const dedupeRecords = (records: EvidenceRecord[]) => {
  const seen = new Set<string>();
  return records.filter((record) => {
    const key = `${record.field}:${normalize(record.value)}:${record.sourceName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const pickBestLabel = (entry?: { labels?: Record<string, { value?: string }> }) => {
  const en = entry?.labels?.en?.value;
  const ru = entry?.labels?.ru?.value;
  return en || ru || null;
};

const extractAliases = (entity: WikidataEntity) => {
  const aliases = [
    ...(entity.aliases?.en || []),
    ...(entity.aliases?.ru || []),
  ]
    .map((alias) => alias.value?.trim() || "")
    .filter((alias) => alias.length > 0);
  return Array.from(new Set(aliases)).slice(0, 4);
};

const scoreCandidate = (
  summary: WikipediaSummary,
  query: { painting: string; artist: string },
) => {
  const text = `${summary.title || ""} ${summary.description || ""} ${summary.extract || ""}`.trim();
  let score = 0;
  if (includesIgnoreCase(text, query.painting)) score += 3;
  if (includesIgnoreCase(text, query.artist)) score += 3;
  if (summary.wikibase_item) score += 1;
  if (summary.type !== "disambiguation") score += 1;
  return score;
};

const searchAndFetchSummary = async ({
  language,
  queryText,
  deadlineAt,
  providerTimeoutMs,
}: {
  language: (typeof WIKIMEDIA_LANGUAGES)[number];
  queryText: string;
  deadlineAt: number;
  providerTimeoutMs: number;
}) => {
  const timeoutMs = getRemainingMs(deadlineAt, providerTimeoutMs);
  if (timeoutMs < 120) return null;

  const searchUrl =
    `https://${language}.wikipedia.org/w/api.php` +
    `?action=query&list=search&format=json&utf8=1&srlimit=4&srsearch=${encodeURIComponent(
      queryText,
    )}`;

  const searchResult = await fetchJsonWithTimeout<WikipediaSearchResponse>(
    searchUrl,
    timeoutMs,
  );
  const titles = (searchResult.query?.search || [])
    .map((item) => item.title || "")
    .filter(Boolean);

  for (const title of titles) {
    const summaryTimeoutMs = getRemainingMs(deadlineAt, providerTimeoutMs);
    if (summaryTimeoutMs < 120) break;
    try {
      const summary = await fetchJsonWithTimeout<WikipediaSummary>(
        `https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
        summaryTimeoutMs,
      );
      if (summary.type === "disambiguation") {
        continue;
      }
      return {
        language,
        summary,
        pageUrl: summary.content_urls?.desktop?.page || PROVIDER_URL,
      };
    } catch {
      continue;
    }
  }

  return null;
};

export async function fetchWikimediaEvidence({
  query,
  deadlineAt,
  providerTimeoutMs,
  tier = "primary",
}: ProviderOptions): Promise<ProviderOutput> {
  const startedAt = Date.now();
  const records: EvidenceRecord[] = [];

  const queryVariants = [
    [query.painting, query.artist].filter(Boolean).join(" "),
    query.painting,
    `${query.painting} painting`,
  ]
    .map((value) => value.trim())
    .filter(Boolean);

  let bestCandidate:
    | {
        language: (typeof WIKIMEDIA_LANGUAGES)[number];
        summary: WikipediaSummary;
        pageUrl: string;
      }
    | null = null;

  for (const queryText of queryVariants) {
    const attempts = await Promise.all(
      WIKIMEDIA_LANGUAGES.map((language) =>
        searchAndFetchSummary({
          language,
          queryText,
          deadlineAt,
          providerTimeoutMs,
        }).catch(() => null),
      ),
    );

    const candidates = attempts.filter(
      (
        value,
      ): value is {
        language: (typeof WIKIMEDIA_LANGUAGES)[number];
        summary: WikipediaSummary;
        pageUrl: string;
      } => Boolean(value),
    );

    if (candidates.length === 0) {
      continue;
    }

    candidates.sort(
      (a, b) => scoreCandidate(b.summary, query) - scoreCandidate(a.summary, query),
    );
    bestCandidate = candidates[0];
    break;
  }

  let sourceUrl = PROVIDER_URL;

  if (bestCandidate) {
    const { summary, pageUrl } = bestCandidate;
    sourceUrl = pageUrl;
    const combined = `${summary.description || ""} ${summary.extract || ""}`.trim();

    if (summary.title) {
      records.push({
        field: "painting",
        value: summary.title,
        sourceName: PROVIDER_NAME,
        sourceUrl,
        confidence: "high",
      });
    }

    if (summary.extract) {
      records.push({
        field: "summary",
        value: summary.extract.slice(0, 500),
        sourceName: PROVIDER_NAME,
        sourceUrl,
        confidence: "medium",
      });
    }

    if (summary.description) {
      records.push({
        field: "summary",
        value: summary.description,
        sourceName: PROVIDER_NAME,
        sourceUrl,
        confidence: "medium",
      });
    }

    if (includesIgnoreCase(combined, query.artist)) {
      records.push({
        field: "artist",
        value: query.artist,
        sourceName: PROVIDER_NAME,
        sourceUrl,
        confidence: "high",
      });
    }

    if (includesIgnoreCase(combined, query.museum)) {
      records.push({
        field: "museum",
        value: query.museum,
        sourceName: PROVIDER_NAME,
        sourceUrl,
        confidence: "medium",
      });
    }

    if (includesIgnoreCase(combined, query.style)) {
      records.push({
        field: "style",
        value: query.style,
        sourceName: PROVIDER_NAME,
        sourceUrl,
        confidence: "medium",
      });
    }

    if (summary.wikibase_item) {
      const timeoutMs = getRemainingMs(deadlineAt, providerTimeoutMs);
      if (timeoutMs >= 220) {
        try {
          const entitiesUrl =
            "https://www.wikidata.org/w/api.php" +
            `?action=wbgetentities&ids=${encodeURIComponent(summary.wikibase_item)}` +
            "&format=json&languages=en|ru&props=labels|aliases|claims";

          const entitiesResponse = await fetchJsonWithTimeout<WikidataEntitiesResponse>(
            entitiesUrl,
            timeoutMs,
          );

          const entity = entitiesResponse.entities?.[summary.wikibase_item];
          const claims = entity?.claims || {};

          const aliases = entity ? extractAliases(entity) : [];
          for (const alias of aliases) {
            records.push({
              field: "painting",
              value: alias,
              sourceName: PROVIDER_NAME,
              sourceUrl: entitiesUrl,
              confidence: "medium",
            });
          }

          const year = parseWikidataYear(getClaimValue(claims, "P571"));
          if (year) {
            records.push({
              field: "year",
              value: year,
              sourceName: PROVIDER_NAME,
              sourceUrl: entitiesUrl,
              confidence: "high",
            });
          }

          const linkedIds = [
            toEntityId(getClaimValue(claims, "P170")),
            toEntityId(getClaimValue(claims, "P195")),
            toEntityId(getClaimValue(claims, "P276")),
            toEntityId(getClaimValue(claims, "P135")),
          ].filter((value): value is string => Boolean(value));

          const uniqueLinkedIds = Array.from(new Set(linkedIds)).slice(0, 6);
          const labelsTimeoutMs = getRemainingMs(deadlineAt, providerTimeoutMs);
          if (uniqueLinkedIds.length > 0 && labelsTimeoutMs >= 220) {
            const labelsUrl =
              "https://www.wikidata.org/w/api.php" +
              `?action=wbgetentities&ids=${encodeURIComponent(uniqueLinkedIds.join("|"))}` +
              "&format=json&languages=en|ru&props=labels";

            const labelsResponse = await fetchJsonWithTimeout<WikidataEntitiesResponse>(
              labelsUrl,
              labelsTimeoutMs,
            );

            const artistId = toEntityId(getClaimValue(claims, "P170"));
            const museumId =
              toEntityId(getClaimValue(claims, "P195")) ||
              toEntityId(getClaimValue(claims, "P276"));
            const styleId = toEntityId(getClaimValue(claims, "P135"));

            const artistLabel = artistId
              ? pickBestLabel(labelsResponse.entities?.[artistId])
              : null;
            if (artistLabel) {
              records.push({
                field: "artist",
                value: artistLabel,
                sourceName: PROVIDER_NAME,
                sourceUrl: labelsUrl,
                confidence: "high",
              });
            }

            const museumLabel = museumId
              ? pickBestLabel(labelsResponse.entities?.[museumId])
              : null;
            if (museumLabel) {
              records.push({
                field: "museum",
                value: museumLabel,
                sourceName: PROVIDER_NAME,
                sourceUrl: labelsUrl,
                confidence: "medium",
              });
            }

            const styleLabel = styleId
              ? pickBestLabel(labelsResponse.entities?.[styleId])
              : null;
            if (styleLabel) {
              records.push({
                field: "style",
                value: styleLabel,
                sourceName: PROVIDER_NAME,
                sourceUrl: labelsUrl,
                confidence: "medium",
              });
            }
          }
        } catch {
          // best-effort enrichment only
        }
      }
    }
  }

  const dedupedRecords = dedupeRecords(records);
  const latencyMs = Date.now() - startedAt;

  return {
    source: {
      name: PROVIDER_NAME,
      url: sourceUrl,
      tier,
      latencyMs,
      ok: dedupedRecords.length > 0,
      recordCount: dedupedRecords.length,
    },
    records: dedupedRecords,
  };
}
