import type {
  EvidenceBundle,
  FactCheckInput,
  FactCheckResult,
  FactsDraft,
} from "@/lib/factcheck/types";
import type { RecognitionFactCheckStatus } from "@/lib/types";

type CanonicalKnowledge = {
  painting: Set<string>;
  artist: Set<string>;
  year: Set<string>;
  museum: Set<string>;
  style: Set<string>;
  evidenceTokens: Set<string>;
};

type ValidateAndMergeOptions = {
  base: FactCheckInput;
  draft: FactsDraft | null;
  evidence: EvidenceBundle;
  maxFacts: number;
  latencyMs: number;
  timedOut: boolean;
};

export type ValidateAndMergeResult = FactCheckResult & {
  diagnostics: {
    candidateFacts: string[];
    verifiedFacts: string[];
    keptSummaryAddonSentences: number;
    droppedSummaryAddonSentences: number;
    evidenceCoverageScore: number;
  };
};

const normalize = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9а-яё\s]/gi, " ").replace(/\s+/g, " ").trim();

const tokenize = (value: string) =>
  normalize(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);

const splitSentences = (value: string) =>
  value
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

const extractYears = (text: string) => {
  const matches = text.match(/\b(1[0-9]{3}|20[0-9]{2})\b/g);
  return Array.from(new Set(matches || []));
};

const addCanonicalValue = (set: Set<string>, value: string) => {
  const normalized = normalize(value);
  if (!normalized || normalized === "unknown") return;
  set.add(normalized);
};

const buildKnowledge = (base: FactCheckInput, evidence: EvidenceBundle): CanonicalKnowledge => {
  const knowledge: CanonicalKnowledge = {
    painting: new Set<string>(),
    artist: new Set<string>(),
    year: new Set<string>(),
    museum: new Set<string>(),
    style: new Set<string>(),
    evidenceTokens: new Set<string>(),
  };

  addCanonicalValue(knowledge.painting, base.painting);
  addCanonicalValue(knowledge.artist, base.artist);
  addCanonicalValue(knowledge.year, base.year);
  addCanonicalValue(knowledge.museum, base.museum);
  addCanonicalValue(knowledge.style, base.style);

  for (const record of evidence.records) {
    if (record.field === "painting") addCanonicalValue(knowledge.painting, record.value);
    if (record.field === "artist") addCanonicalValue(knowledge.artist, record.value);
    if (record.field === "year") addCanonicalValue(knowledge.year, record.value);
    if (record.field === "museum") addCanonicalValue(knowledge.museum, record.value);
    if (record.field === "style") addCanonicalValue(knowledge.style, record.value);

    for (const token of tokenize(record.value)) {
      knowledge.evidenceTokens.add(token);
    }
  }

  return knowledge;
};

const hasYearConflict = (text: string, knownYears: Set<string>) => {
  if (knownYears.size === 0) return false;
  const yearsInText = extractYears(text);
  if (yearsInText.length === 0) return false;

  for (const year of yearsInText) {
    const hasMatch = Array.from(knownYears).some((known) => known.includes(year));
    if (!hasMatch) return true;
  }
  return false;
};

const hasCoreFieldMention = (text: string, knowledge: CanonicalKnowledge) => {
  const normalized = normalize(text);
  if (!normalized) return false;

  const groups = [
    knowledge.painting,
    knowledge.artist,
    knowledge.museum,
    knowledge.style,
  ];

  return groups.some((group) =>
    Array.from(group).some((value) => value.length >= 4 && normalized.includes(value)),
  );
};

const hasEvidenceTokenSupport = (text: string, tokens: Set<string>) => {
  if (tokens.size === 0) return false;
  const candidates = tokenize(text);
  if (candidates.length === 0) return false;

  let matched = 0;
  for (const token of candidates) {
    if (tokens.has(token)) matched += 1;
  }

  return matched >= 2 || (matched >= 1 && candidates.length <= 7);
};

const isSupportedText = (text: string, knowledge: CanonicalKnowledge) => {
  if (!text.trim()) return false;
  if (hasYearConflict(text, knowledge.year)) return false;
  if (hasCoreFieldMention(text, knowledge)) return true;
  return hasEvidenceTokenSupport(text, knowledge.evidenceTokens);
};

const dedupeFacts = (facts: string[]) => {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const fact of facts) {
    const normalized = normalize(fact);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(fact.trim());
  }
  return output;
};

const chooseStatus = (
  evidence: EvidenceBundle,
  timedOut: boolean,
  verifiedFacts: number,
  keptSummaryAddonSentences: number,
): RecognitionFactCheckStatus => {
  if (evidence.records.length === 0) {
    return timedOut ? "skipped_timeout" : "skipped_no_evidence";
  }

  if (timedOut && verifiedFacts === 0 && keptSummaryAddonSentences === 0) {
    return "skipped_timeout";
  }

  if (verifiedFacts >= 2 || keptSummaryAddonSentences >= 1) {
    return "verified";
  }

  return "partial";
};

export function validateAndMerge({
  base,
  draft,
  evidence,
  maxFacts,
  latencyMs,
  timedOut,
}: ValidateAndMergeOptions): ValidateAndMergeResult {
  const safeMaxFacts = Math.min(Math.max(maxFacts, 1), 5);
  const knowledge = buildKnowledge(base, evidence);

  const candidateFacts = (draft?.facts || [])
    .map((fact) => fact.trim())
    .filter((fact) => fact.length >= 12);

  const verifiedFacts = dedupeFacts(
    candidateFacts.filter((fact) => isSupportedText(fact, knowledge)),
  ).slice(0, safeMaxFacts);

  const addonSentences = splitSentences(draft?.summaryAddon || "");
  const keptAddonSentences = addonSentences
    .filter((sentence) => isSupportedText(sentence, knowledge))
    .slice(0, 2);

  const mergedSummaryParts = [base.summary.trim()];
  if (keptAddonSentences.length > 0) {
    mergedSummaryParts.push(keptAddonSentences.join(" "));
  }
  const mergedSummary = mergedSummaryParts.filter(Boolean).join(" ").trim();

  return {
    facts: verifiedFacts,
    summary: mergedSummary || base.summary,
    factCheck: {
      status: chooseStatus(
        evidence,
        timedOut,
        verifiedFacts.length,
        keptAddonSentences.length,
      ),
      verifiedFacts: verifiedFacts.length,
      sources: Array.from(
        new Set(
          evidence.sources
            .filter((source) => source.ok && source.recordCount > 0)
            .map((source) => source.name),
        ),
      ),
      latencyMs,
    },
    diagnostics: {
      candidateFacts,
      verifiedFacts,
      keptSummaryAddonSentences: keptAddonSentences.length,
      droppedSummaryAddonSentences: Math.max(
        addonSentences.length - keptAddonSentences.length,
        0,
      ),
      evidenceCoverageScore: evidence.coverageScore,
    },
  };
}
