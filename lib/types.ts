export type RecognitionConfidence = "high" | "medium" | "low";
export type RecognitionFactCheckStatus =
  | "verified"
  | "partial"
  | "skipped_timeout"
  | "skipped_no_evidence";

export type RecognitionErrorCode =
  | "bad_request"
  | "misconfigured_env"
  | "billing"
  | "timeout"
  | "upstream_error"
  | "non_json_response"
  | "network";

export type RecognitionFactCheck = {
  status: RecognitionFactCheckStatus;
  verifiedFacts: number;
  sources: string[];
  latencyMs: number;
};

export type RecognitionResponse = {
  painting: string;
  artist: string;
  year: string;
  museum: string;
  style: string;
  confidence: RecognitionConfidence;
  reasoning: string;
  summary: string;
  facts: string[];
  factCheck: RecognitionFactCheck;
  requestId: string;
};

export type RecognitionErrorResponse = {
  error: string;
  code: RecognitionErrorCode;
  requestId: string;
};
