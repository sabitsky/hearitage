import type {
  RecognitionConfidence,
  RecognitionFactCheck,
} from "@/lib/types";

export type EvidenceField =
  | "painting"
  | "artist"
  | "year"
  | "museum"
  | "style"
  | "summary";

export type EvidenceConfidence = "high" | "medium" | "low";

export type EvidenceRecord = {
  field: EvidenceField;
  value: string;
  sourceName: string;
  sourceUrl: string;
  confidence: EvidenceConfidence;
};

export type EvidenceSource = {
  name: string;
  url: string;
  tier: "primary" | "secondary";
  latencyMs: number;
  ok: boolean;
  recordCount: number;
};

export type EvidenceCoverage = {
  hasPainting: boolean;
  hasArtist: boolean;
  hasYear: boolean;
  hasMuseum: boolean;
  hasStyle: boolean;
};

export type EvidenceBundle = {
  records: EvidenceRecord[];
  sources: EvidenceSource[];
  fetchedAt: string;
  latencyMs: number;
  coverage: EvidenceCoverage;
  coverageScore: number;
  primaryCoverageScore: number;
  timedOut: boolean;
};

export type FactCheckInput = {
  painting: string;
  artist: string;
  year: string;
  museum: string;
  style: string;
  summary: string;
  confidence: RecognitionConfidence;
};

export type FactsDraft = {
  facts: string[];
  summaryAddon: string;
};

export type FactCheckResult = {
  facts: string[];
  summary: string;
  factCheck: RecognitionFactCheck;
};

export type FactCheckLogger = (
  stage: string,
  details?: Record<string, unknown>,
) => void;

export type ProviderOptions = {
  query: FactCheckInput;
  deadlineAt: number;
  providerTimeoutMs: number;
  tier?: "primary" | "secondary";
};

export type ProviderOutput = {
  source: EvidenceSource;
  records: EvidenceRecord[];
};
