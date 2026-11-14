import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { pool } from "@workspace/db";
import {
  alertEmailConfig,
  deliverUsageAlerts,
  sendAlertEmail,
  type UsageAlert,
} from "../src/lib/ask-local-alerts";
import { RESERVE_ATTEMPT_SQL } from "../src/lib/ask-local-usage";

after(() => pool.end());
const config = { apiKey: "dummy-only", from: "guide@example.test", to: "owner@example.test" };

test("email is opt-in and enabled configuration requires one private mailbox", () => {
  const keys = ["ASK_LOCAL_ALERT_EMAIL_ENABLED", "RESEND_API_KEY",
    "ASK_LOCAL_ALERT_EMAIL_FROM", "ASK_LOCAL_ALERT_EMAIL_TO"];
  const previous = keys.map((key) => process.env[key]);
  try {
    for (const key of keys) delete process.env[key];
    assert.equal(alertEmailConfig(), null);
    process.env.ASK_LOCAL_ALERT_EMAIL_ENABLED = "false";
    assert.equal(alertEmailConfig(), null);
    process.env.ASK_LOCAL_ALERT_EMAIL_ENABLED = "yes";
    assert.throws(alertEmailConfig, /AI_ALERT_CONFIG_INVALID/);
    process.env.ASK_LOCAL_ALERT_EMAIL_ENABLED = "true";
    assert.throws(alertEmailConfig, /AI_ALERT_CONFIG_INVALID/);
    process.env.RESEND_API_KEY = config.apiKey;
    process.env.ASK_LOCAL_ALERT_EMAIL_FROM = config.from;
    process.env.ASK_LOCAL_ALERT_EMAIL_TO = "one@example.test,two@example.test";
    assert.throws(alertEmailConfig, /AI_ALERT_CONFIG_INVALID/);
    process.env.ASK_LOCAL_ALERT_EMAIL_TO = config.to;
    assert.deepEqual(alertEmailConfig(), config);
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
});

test("email sends only aggregate facts and retries with the identical provider key", async () => {
  const alert: UsageAlert = {
    day: "2026-11-13", threshold: 80, attempts: 80, allowance: 100, lease: "unused",
  };
  const requests: RequestInit[] = [];
  const fakeFetch: typeof fetch = async (url, request) => {
    assert.equal(url, "https://api.resend.com/emails");
    requests.push(request!);
    return new Response("sensitive provider error body", { status: requests.length === 1 ? 503 : 200 });
  };
  await assert.rejects(sendAlertEmail(alert, config, fakeFetch), /^Error: AI_ALERT_DELIVERY_FAILED$/);
  await sendAlertEmail(alert, config, fakeFetch);
  assert.deepEqual(requests[0], requests[1]);
  assert.equal((requests[0].headers as Record<string, string>)["Idempotency-Key"],
    "ask-local-allowance/2026-11-13/80");
  const body = JSON.parse(requests[0].body as string);
  assert.deepEqual(Object.keys(body).sort(), ["from", "subject", "text", "to"]);
  assert.equal(body.from, config.from);
  assert.deepEqual(body.to, [config.to]);
  assert.match(body.text, /80 of 100/);
  assert.match(body.text, /midnight UTC/);
  assert.ok(!JSON.stringify(body).includes(config.apiKey));
  await assert.rejects(sendAlertEmail(alert, config, async () => {
    throw new Error("secret failure detail");
  }), /secret failure detail/);
});

test("durable outbox deduplicates across instances, recovers failures, and never reopens quota", async () => {
  const schema = `alerts_test_${randomUUID().replaceAll("-", "")}`;
  const clients = await Promise.all([pool.connect(), pool.connect(), pool.connect()]);
  try {
    await clients[0].query(`CREATE SCHEMA "${schema}"`);
    for (const client of clients) await client.query(`SET search_path TO "${schema}"`);
    await clients[0].query(`CREATE TABLE ask_local_daily_usage (
      day date PRIMARY KEY, attempts integer NOT NULL CHECK (attempts > 0)
    );
    CREATE TABLE ask_local_usage_alerts (
      day date NOT NULL, threshold integer NOT NULL,
      attempts integer NOT NULL, allowance integer NOT NULL,
      status text NOT NULL DEFAULT 'pending', first_attempt_at timestamptz,
      lease_until timestamptz, next_attempt_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (day, threshold)
    )`);
    // Same thresholds on a previous day do not suppress today's alerts.
    await clients[0].query(`INSERT INTO ask_local_usage_alerts
      (day, threshold, attempts, allowance) VALUES
      ((statement_timestamp() AT TIME ZONE 'UTC')::date - 1, 80, 80, 100)`);
    const allowed = [];
    for (let i = 1; i <= 79; i++) {
      allowed.push(await clients[i % 3].query(RESERVE_ATTEMPT_SQL, [100]));
    }
    assert.equal((await clients[0].query(`SELECT count(*)::int AS n
      FROM ask_local_usage_alerts WHERE day = (statement_timestamp() AT TIME ZONE 'UTC')::date`)).rows[0].n, 0);
    const reservations = await Promise.all(clients.map(async (client) => {
      const rows = [];
      for (let i = 0; i < 15; i++) rows.push(await client.query(RESERVE_ATTEMPT_SQL, [100]));
      return rows;
    }));
    assert.equal(reservations.flat().filter((r) => r.rows[0].allowed).length, 21);
    const rows = await clients[0].query(`SELECT threshold, attempts FROM ask_local_usage_alerts
      WHERE day = (statement_timestamp() AT TIME ZONE 'UTC')::date ORDER BY threshold`);
    assert.deepEqual(rows.rows, [{ threshold: 80, attempts: 80 }, { threshold: 100, attempts: 100 }]);

    let sends = 0;
    const query = clients[0].query.bind(clients[0]);
    const failingSend = async () => { sends++; throw new Error("private detail never logged"); };
    await Promise.all(clients.map((client) =>
      deliverUsageAlerts(config, client.query.bind(client), failingSend)));
    assert.equal(sends, 2); // one lease holder per threshold, despite three instances
    assert.equal((await clients[0].query(RESERVE_ATTEMPT_SQL, [100])).rows[0].allowed, false);
    assert.equal((await clients[0].query(`SELECT attempts FROM ask_local_daily_usage`)).rows[0].attempts, 100);

    // No immediate retry storm.
    await deliverUsageAlerts(config, query, failingSend);
    assert.equal(sends, 2);
    await clients[0].query(`UPDATE ask_local_usage_alerts SET next_attempt_at = now() - interval '1 second'`);

    // Model a provider accepting delivery, followed by a process dying before
    // recording success. A new connection retries the same immutable email/key.
    const providerKeys = new Set<string>();
    let providerRequests = 0;
    const sentPayloads = new Map<string, string>();
    const send = async (alert: UsageAlert) => sendAlertEmail(alert, config, async (_url, request) => {
      const key = (request!.headers as Record<string, string>)["Idempotency-Key"];
      const body = request!.body as string;
      if (sentPayloads.has(key)) assert.equal(body, sentPayloads.get(key));
      sentPayloads.set(key, body);
      providerKeys.add(key);
      providerRequests++;
      return new Response("{}", { status: 200 });
    });
    await assert.rejects(deliverUsageAlerts(config, (async (sql: unknown, ...args: unknown[]) => {
      if (typeof sql === "string" && sql.includes("SET status = $4")) throw new Error("crash");
      return query(sql as string, ...args as []);
    }) as typeof pool.query, send), /crash/);
    // Promise.all may still be completing its second send; no actual network calls.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(providerKeys.size, 2);
    await clients[0].query(`UPDATE ask_local_usage_alerts SET lease_until = now() - interval '1 second'`);
    const fresh = await pool.connect();
    try {
      await fresh.query(`SET search_path TO "${schema}"`);
      await deliverUsageAlerts(config, fresh.query.bind(fresh), send);
      await deliverUsageAlerts(config, fresh.query.bind(fresh), send);
    } finally {
      await fresh.query("RESET search_path");
      fresh.release();
    }
    assert.equal(providerKeys.size, 2);
    assert.equal(providerRequests, 4); // two real emails, two idempotent recoveries
    assert.equal((await clients[0].query(`SELECT count(*)::int AS n
      FROM ask_local_usage_alerts WHERE status = 'sent'`)).rows[0].n, 2);
    assert.equal((await clients[0].query(`SELECT status FROM ask_local_usage_alerts
      WHERE day < (statement_timestamp() AT TIME ZONE 'UTC')::date`)).rows[0].status, "expired");

    // Never retry after the provider's safe deduplication window.
    await clients[0].query(`UPDATE ask_local_usage_alerts SET status = 'pending',
      first_attempt_at = now() - interval '23 hours', lease_until = NULL,
      next_attempt_at = now() - interval '1 second'`);
    await deliverUsageAlerts(config, query, send);
    assert.equal(providerRequests, 4);
    assert.equal((await clients[0].query(`SELECT count(*)::int AS n
      FROM ask_local_usage_alerts WHERE status = 'pending'`)).rows[0].n, 0);
  } finally {
    for (const client of clients) await client.query("RESET search_path");
    await clients[0].query(`DROP SCHEMA "${schema}" CASCADE`);
    for (const client of clients) client.release();
  }
});
