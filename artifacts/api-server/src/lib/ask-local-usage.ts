import { pool } from "@workspace/db";

export class DailyLimitReached extends Error {
  constructor(public readonly retryAfter: number) {
    super("AI_DAILY_LIMIT_REACHED");
  }
}

export function dailyAllowance(): number {
  const configured = process.env.ASK_LOCAL_DAILY_LIMIT ?? "100";
  if (!/^[1-9]\d*$/.test(configured) || !Number.isSafeInteger(Number(configured))) {
    throw new Error("AI_INVALID_DAILY_LIMIT");
  }
  return Number(configured);
}

// One atomic statement: concurrent instances cannot reserve the same final slot.
// Use the database clock so all instances agree on the UTC date and reset time.
export const RESERVE_ATTEMPT_SQL = `
  WITH reservation AS (
    INSERT INTO ask_local_daily_usage (day, attempts)
    VALUES ((statement_timestamp() AT TIME ZONE 'UTC')::date, 1)
    ON CONFLICT (day) DO UPDATE
      SET attempts = ask_local_daily_usage.attempts + 1
      WHERE ask_local_daily_usage.attempts < $1
    RETURNING day
  )
  SELECT EXISTS (SELECT 1 FROM reservation) AS allowed,
    GREATEST(1, CEIL(EXTRACT(EPOCH FROM (
      (((statement_timestamp() AT TIME ZONE 'UTC')::date + 1)::timestamp
        AT TIME ZONE 'UTC') - statement_timestamp()
    ))))::integer AS retry_after
`;

export async function reserveDailyAttempt(): Promise<void> {
  const query = {
    text: RESERVE_ATTEMPT_SQL,
    values: [dailyAllowance()],
    // Supported by node-postgres at runtime, but absent from its QueryConfig type.
    query_timeout: 3000,
  };
  const result = await pool.query<{ allowed: boolean; retry_after: number }>(query);
  const row = result.rows[0];
  if (!row) throw new Error("AI_USAGE_UNAVAILABLE");
  if (!row.allowed) throw new DailyLimitReached(row.retry_after);
  // Never refund: timeouts/errors may already have incurred provider charges.
}
