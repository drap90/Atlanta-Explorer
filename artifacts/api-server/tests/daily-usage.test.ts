import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { pool } from "@workspace/db";
import { askGemini } from "../src/lib/ask-local";
import {
  DailyLimitReached,
  dailyAllowance,
  RESERVE_ATTEMPT_SQL,
} from "../src/lib/ask-local-usage";

test("daily allowance defaults safely and rejects invalid configuration", () => {
  const previous = process.env.ASK_LOCAL_DAILY_LIMIT;
  try {
    delete process.env.ASK_LOCAL_DAILY_LIMIT;
    assert.equal(dailyAllowance(), 100);
    for (const value of ["0", "-1", "1.5", "", "abc", "1e3", "9007199254740992"]) {
      process.env.ASK_LOCAL_DAILY_LIMIT = value;
      assert.throws(dailyAllowance, /AI_INVALID_DAILY_LIMIT/);
    }
    process.env.ASK_LOCAL_DAILY_LIMIT = "500";
    assert.equal(dailyAllowance(), 500);
  } finally {
    if (previous === undefined) delete process.env.ASK_LOCAL_DAILY_LIMIT;
    else process.env.ASK_LOCAL_DAILY_LIMIT = previous;
  }
});

test("shared reservations stop exactly at the cap and persist between connections", async () => {
  // Isolate tests from the real guide's daily allowance; never reset real usage.
  const schema = `quota_test_${randomUUID().replaceAll("-", "")}`;
  const clients = await Promise.all([pool.connect(), pool.connect(), pool.connect()]);
  try {
    await clients[0].query(`CREATE SCHEMA "${schema}"`);
    await clients[0].query(`CREATE TABLE "${schema}".ask_local_daily_usage (
      day date PRIMARY KEY, attempts integer NOT NULL CHECK (attempts > 0)
    )`);
    for (const client of clients) await client.query(`SET search_path TO "${schema}"`);
    // Yesterday's exhausted allowance must not prevent today's first reservation.
    await clients[0].query(`INSERT INTO ask_local_daily_usage VALUES (
      (statement_timestamp() AT TIME ZONE 'UTC')::date - 1, 100
    )`);
    const results = (await Promise.all(clients.map(async (client, index) => {
      const reservations = [];
      for (let i = index; i < 40; i += clients.length) {
        reservations.push(await client.query(RESERVE_ATTEMPT_SQL, [7]));
      }
      return reservations;
    }))).flat();
    assert.equal(results.filter((r) => r.rows[0].allowed).length, 7);
    for (const result of results) {
      assert.ok(result.rows[0].retry_after > 0);
      assert.ok(result.rows[0].retry_after <= 86400);
    }
    const usage = await clients[0].query(`SELECT attempts FROM ask_local_daily_usage
      WHERE day = (statement_timestamp() AT TIME ZONE 'UTC')::date`);
    assert.equal(usage.rows[0].attempts, 7);
    // A newly checked-out connection (as after an instance restart) sees exhaustion.
    const fresh = await pool.connect();
    try {
      await fresh.query(`SET search_path TO "${schema}"`);
      assert.equal((await fresh.query(RESERVE_ATTEMPT_SQL, [7])).rows[0].allowed, false);
    } finally {
      await fresh.query("RESET search_path");
      fresh.release();
    }
  } finally {
    for (const client of clients) await client.query("RESET search_path");
    await clients[0].query(`DROP SCHEMA "${schema}" CASCADE`);
    for (const client of clients) client.release();
    await pool.end();
  }
});

test("no provider call escapes reservation, including retries and store failures", async () => {
  // Compile this test with GEMINI_API_KEY defined to a dummy value: never use a
  // real credential and never make a real network request in this test.
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return new Response("{}", { status: 503 });
  };
  try {
    await assert.rejects(askGemini("Parks?", "en", async () => {
      throw new DailyLimitReached(100);
    }), DailyLimitReached);
    assert.equal(providerCalls, 0);
    await assert.rejects(askGemini("Parks?", "en", async () => {
      throw new Error("STORE_UNAVAILABLE");
    }), /STORE_UNAVAILABLE/);
    assert.equal(providerCalls, 0);
    let attempts = 0;
    await assert.rejects(askGemini("Parks?", "en", async () => {
      if (++attempts > 1) throw new DailyLimitReached(100);
    }), DailyLimitReached);
    assert.equal(attempts, 2);
    assert.equal(providerCalls, 1);

    providerCalls = 0;
    attempts = 0;
    await assert.rejects(askGemini("Parks?", "en", async () => { attempts += 1; }), /AI_HTTP_503/);
    assert.equal(attempts, 2);
    assert.equal(providerCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
