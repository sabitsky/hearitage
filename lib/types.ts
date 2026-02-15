export type RecognitionConfidence = "high" | "medium" | "low";
export type RecognitionErrorCode =
  | "bad_request"
  | "misconfigured_env"
  | "billing"
  | "timeout"
  | "upstream_error"
  | "non_json_response"
  | "network";

export type RecognitionResponse = {
  painting: string;
  artist: string;
  year: string;
  museum: string;
  style: string;
  confidence: RecognitionConfidence;
  reasoning: string;
  summary: string;
  requestId: string;
};

export type RecognitionErrorResponse = {
  error: string;
  code: RecognitionErrorCode;
  requestId: string;
};
