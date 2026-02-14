export type RecognitionConfidence = "high" | "medium" | "low";

export type RecognitionResponse = {
  painting: string;
  artist: string;
  year: string;
  museum: string;
  style: string;
  confidence: RecognitionConfidence;
  summary: string;
};
