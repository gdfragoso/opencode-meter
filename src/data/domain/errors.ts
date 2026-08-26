export interface ErrorRow {
  source: "session" | "event";
  id: string;
  session_id: string | null;
  title: string | null;
  error_type: string | null;
  error_message: string | null;
  started_at: number | null;
}

export interface DailyErrorCount {
  date: string;
  count: number;
}

export interface ErrorsResponse {
  total: number;
  byType: Record<string, number>;
  daily: DailyErrorCount[];
  errors: ErrorRow[];
}

export const ERROR_TYPE_BUCKETS: Record<string, string> = {
  APIError: "api_error",
  ApiError: "api_error",
  MessageOutputLengthError: "context_length",
  RateLimitError: "rate_limit",
  TimeoutError: "timeout",
  UnknownError: "unknown",
  MessageAbortedError: "aborted",
  ContentFilterError: "content_filter",
};

export function bucketType(name: string | null): string | null {
  if (!name) return null;
  return ERROR_TYPE_BUCKETS[name] ?? name;
}
