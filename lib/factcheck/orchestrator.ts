import { fetchAicEvidence } from "@/lib/factcheck/providers/aic";
import { fetchCmaEvidence } from "@/lib/factcheck/providers/cma";
import { fetchWikimediaEvidence } from "@/lib/factcheck/providers/wikimedia";
import type {
  EvidenceBundle,
  EvidenceCoverage,
  FactCheckInput,
  FactCheckLogger,
  ProviderOutput,
} from "@/lib/factcheck/types";

type FetchEvidenceOptions = {
  query: FactCheckInput;
  budgetMs: number;
  providerTimeoutMs: number;
  phaseABudgetMs?: number;
  responseBufferMs?: number;
  logger?: FactCheckLogger;
};

const DEFAULT_PHASE_A_BUDGET_MS = 900;
const DEFAULT_RESPONSE_BUFFER_MS = 200;

const emptyCoverage = (): EvidenceCoverage => ({
  hasPainting: false,
  hasArtist: false,
  hasYear: false,
  hasMuseum: false,
  hasStyle: false,
});

const computeCoverage = (records: EvidenceBundle["records"]) => {
  const coverage = emptyCoverage();
  for (const record of records) {
    if (record.field === "painting") coverage.hasPainting = true;
    if (record.field === "artist") coverage.hasArtist = true;
    if (record.field === "year") coverage.hasYear = true;
    if (record.field === "museum") coverage.hasMuseum = true;
    if (record.field === "style") coverage.hasStyle = true;
  }
  const score = [
    coverage.hasPainting,
    coverage.hasArtist,
    coverage.hasYear,
    coverage.hasMuseum,
    coverage.hasStyle,
  ].filter(Boolean).length;

  return { coverage, score };
};

const joinProviderResults = (results: ProviderOutput[]) => {
  const records = results.flatMap((result) => result.records);
  const sources = results.map((result) => result.source);
  return { records, sources };
};

export async function fetchEvidenceBundle({
  query,
  budgetMs,
  providerTimeoutMs,
  phaseABudgetMs = DEFAULT_PHASE_A_BUDGET_MS,
  responseBufferMs = DEFAULT_RESPONSE_BUFFER_MS,
  logger,
}: FetchEvidenceOptions): Promise<EvidenceBundle> {
  const startedAt = Date.now();
  const globalBudgetMs = Math.max(600, budgetMs);
  const deadlineAt = startedAt + globalBudgetMs;
  const hardStopAt = deadlineAt - Math.max(80, responseBufferMs);
  const phaseAStopAt = Math.min(hardStopAt, startedAt + Math.max(300, phaseABudgetMs));

  logger?.("evidence_fetch_start", {
    budgetMs: globalBudgetMs,
    providerTimeoutMs,
    phaseABudgetMs,
  });

  const phaseAResult = await fetchWikimediaEvidence({
    query,
    deadlineAt: phaseAStopAt,
    providerTimeoutMs,
    tier: "primary",
  }).catch((error) => {
    logger?.("evidence_fetch_provider_error", {
      provider: "wikimedia",
      message: error instanceof Error ? error.message : "unknown",
    });
    return {
      source: {
        name: "Wikimedia",
        url: "https://www.wikipedia.org",
        tier: "primary",
        latencyMs: 0,
        ok: false,
        recordCount: 0,
      },
      records: [],
    } satisfies ProviderOutput;
  });

  logger?.("evidence_fetch_provider_end", {
    provider: "wikimedia",
    tier: "primary",
    latencyMs: phaseAResult.source.latencyMs,
    records: phaseAResult.source.recordCount,
    ok: phaseAResult.source.ok,
  });

  const phaseACombined = joinProviderResults([phaseAResult]);
  const phaseACoverage = computeCoverage(phaseACombined.records);

  const remainingMsAfterA = hardStopAt - Date.now();
  let secondaryResults: ProviderOutput[] = [];

  if (remainingMsAfterA > 220) {
    logger?.("evidence_fetch_phase_b_start", {
      remainingMs: remainingMsAfterA,
    });

    const secondaryDeadlineAt = hardStopAt;
    const perSecondaryTimeout = Math.max(
      200,
      Math.min(providerTimeoutMs, Math.floor(remainingMsAfterA * 0.9)),
    );

    secondaryResults = await Promise.all(
      [
        fetchAicEvidence({
          query,
          deadlineAt: secondaryDeadlineAt,
          providerTimeoutMs: perSecondaryTimeout,
          tier: "secondary",
        }),
        fetchCmaEvidence({
          query,
          deadlineAt: secondaryDeadlineAt,
          providerTimeoutMs: perSecondaryTimeout,
          tier: "secondary",
        }),
      ].map((task, index) =>
        task.catch((error) => {
          const provider = index === 0 ? "aic" : "cma";
          logger?.("evidence_fetch_provider_error", {
            provider,
            tier: "secondary",
            message: error instanceof Error ? error.message : "unknown",
          });
          return {
            source: {
              name:
                index === 0
                  ? "Art Institute of Chicago"
                  : "Cleveland Museum of Art",
              url: "",
              tier: "secondary",
              latencyMs: 0,
              ok: false,
              recordCount: 0,
            },
            records: [],
          } satisfies ProviderOutput;
        }),
      ),
    );

    for (const result of secondaryResults) {
      logger?.("evidence_fetch_provider_end", {
        provider: result.source.name,
        tier: "secondary",
        latencyMs: result.source.latencyMs,
        records: result.source.recordCount,
        ok: result.source.ok,
      });
    }
  } else {
    logger?.("evidence_fetch_phase_b_skipped", {
      reason: "insufficient_budget",
      remainingMs: remainingMsAfterA,
    });
  }

  const combined = joinProviderResults([phaseAResult, ...secondaryResults]);
  const coverage = computeCoverage(combined.records);
  const latencyMs = Date.now() - startedAt;
  const timedOut = Date.now() > deadlineAt;

  logger?.("evidence_fetch_end", {
    latencyMs,
    timedOut,
    sourceCount: combined.sources.length,
    recordCount: combined.records.length,
    coverageScore: coverage.score,
    primaryCoverageScore: phaseACoverage.score,
  });

  return {
    records: combined.records,
    sources: combined.sources,
    fetchedAt: new Date().toISOString(),
    latencyMs,
    coverage: coverage.coverage,
    coverageScore: coverage.score,
    primaryCoverageScore: phaseACoverage.score,
    timedOut,
  };
}
