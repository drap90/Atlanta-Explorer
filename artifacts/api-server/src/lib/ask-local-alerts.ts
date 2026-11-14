import { pool } from "@workspace/db";
import { logger } from "./logger";

type EmailConfig = { apiKey: string; from: string; to: string };
export type UsageAlert = {
  day: string;
  threshold: number;
  attempts: number;
  allowance: number;
  lease: string;
};

export function alertEmailConfig(): EmailConfig | null {
  const enabled = process.env.ASK_LOCAL_ALERT_EMAIL_ENABLED;
  if (enabled === undefined || enabled === "false") return null;
  if (enabled !== "true") throw new Error("AI_ALERT_CONFIG_INVALID");
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ASK_LOCAL_ALERT_EMAIL_FROM;
  const to = process.env.ASK_LOCAL_ALERT_EMAIL_TO;
  // One owner mailbox, not a visitor-supplied list or a public destination.
  const mailbox = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
  if (!apiKey || !from || !to || !mailbox.test(from) || !mailbox.test(to)) {
    throw new Error("AI_ALERT_CONFIG_INVALID");
  }
  return { apiKey, from, to };
}

// Provider keys last 24h. Stop retries after 23h to leave a safety margin.
// Unsent alerts from previous UTC days expire rather than sending stale warnings.
export const EXPIRE_ALERTS_SQL = `
  UPDATE ask_local_usage_alerts SET status = 'expired'
  WHERE status = 'pending' AND (
    first_attempt_at <= statement_timestamp() - interval '23 hours'
    OR (first_attempt_at IS NULL
      AND day < (statement_timestamp() AT TIME ZONE 'UTC')::date)
  )
  RETURNING day::text, threshold
`;

export const CLAIM_ALERTS_SQL = `
  WITH candidates AS (
    SELECT day, threshold FROM ask_local_usage_alerts
    WHERE status = 'pending' AND next_attempt_at <= statement_timestamp()
      AND (lease_until IS NULL OR lease_until <= statement_timestamp())
      AND (first_attempt_at > statement_timestamp() - interval '23 hours'
        OR (first_attempt_at IS NULL
          AND day = (statement_timestamp() AT TIME ZONE 'UTC')::date))
    ORDER BY day, threshold
    LIMIT 2 FOR UPDATE SKIP LOCKED
  )
  UPDATE ask_local_usage_alerts AS alert
  SET lease_until = statement_timestamp() + interval '1 minute',
    first_attempt_at = COALESCE(alert.first_attempt_at, statement_timestamp())
  FROM candidates
  WHERE alert.day = candidates.day AND alert.threshold = candidates.threshold
  RETURNING alert.day::text, alert.threshold, alert.attempts, alert.allowance,
    alert.lease_until::text AS lease
`;

export const FINISH_ALERT_SQL = `
  UPDATE ask_local_usage_alerts
  SET status = $4, lease_until = NULL,
    next_attempt_at = statement_timestamp() + interval '5 minutes'
  WHERE day = $1 AND threshold = $2 AND lease_until = $3::timestamptz
    AND status = 'pending'
`;

export function alertEmail(alert: UsageAlert) {
  return {
    subject: `Ask a Local: ${alert.threshold}% daily allowance reached (${alert.day} UTC)`,
    text: [
      `Ask a Local reached its ${alert.threshold}% daily allowance threshold.`,
      `UTC day: ${alert.day}`,
      `Aggregate Gemini attempts: ${alert.attempts} of ${alert.allowance}.`,
      "Attempts include retries and failed provider calls, not just successful questions.",
      "The daily cap remains enforced. The allowance resets at midnight UTC.",
    ].join("\n"),
  };
}

export async function sendAlertEmail(
  alert: UsageAlert,
  config: EmailConfig,
  fetchEmail: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchEmail("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      // Stable across processes, crashes, and retries. Never contains visitor data.
      "Idempotency-Key": `ask-local-allowance/${alert.day}/${alert.threshold}`,
    },
    body: JSON.stringify({ from: config.from, to: [config.to], ...alertEmail(alert) }),
    signal: AbortSignal.timeout(10_000),
    redirect: "error",
  });
  // Never retain/log the provider response, addresses, or credentials.
  await response.body?.cancel();
  if (!response.ok) throw new Error("AI_ALERT_DELIVERY_FAILED");
}

// Injection supports isolated database tests and fake delivery, not a public API.
export async function deliverUsageAlerts(
  config: EmailConfig,
  query: typeof pool.query = pool.query.bind(pool),
  send: typeof sendAlertEmail = sendAlertEmail,
): Promise<void> {
  const expired = await query(EXPIRE_ALERTS_SQL);
  if (expired.rowCount) {
    logger.warn({ count: expired.rowCount }, "AI allowance alerts expired without confirmed delivery");
  }
  const claimed = await query<UsageAlert>(CLAIM_ALERTS_SQL);
  await Promise.all(claimed.rows.map(async (alert) => {
    let status = "sent";
    try {
      await send(alert, config);
    } catch {
      status = "pending";
      logger.warn({ day: alert.day, threshold: alert.threshold }, "AI allowance email failed; retry scheduled");
    }
    // If this update fails after a successful send, the next lease holder uses
    // the SAME provider key and immutable aggregate snapshot, not a new email.
    await query(FINISH_ALERT_SQL, [alert.day, alert.threshold, alert.lease, status]);
  }));
}

export function startUsageAlertWorker(): () => void {
  let config: EmailConfig | null;
  try {
    config = alertEmailConfig();
  } catch {
    logger.error("AI allowance email disabled: invalid configuration");
    return () => {};
  }
  if (!config) {
    logger.info("AI allowance email disabled; owner email setup is deferred");
    return () => {};
  }
  const email = config;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await deliverUsageAlerts(email);
    } catch {
      // Deliberately omit error objects: they may contain database or HTTP secrets.
      logger.error("AI allowance alert worker failed; daily cap remains enforced");
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), 30_000);
  timer.unref();
  return () => clearInterval(timer);
}
