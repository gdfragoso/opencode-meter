import type { Database } from "bun:sqlite";
import { bucketType } from "@/data/domain/errors";
import type { ErrorsResponse } from "@/data/domain/errors";
import { findDailyErrorCounts, findErrors } from "@/data/repositories/errors";

export function getErrors(
  db: Database,
  days: number | null = null,
  project: string | null = null,
  branch: string | null = null
): ErrorsResponse {
  const errors = findErrors(db, days, project, branch);

  const byType: Record<string, number> = {
    rate_limit: 0,
    context_length: 0,
    api_error: 0,
    timeout: 0,
  };

  for (const row of errors) {
    const bucket = bucketType(row.error_type);
    if (bucket) byType[bucket] = (byType[bucket] ?? 0) + 1;
  }

  const daily = findDailyErrorCounts(db, days, project, branch);

  return {
    total: errors.length,
    byType,
    daily,
    errors,
  };
}
