import { check, date, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Aggregate counts only: never retain questions, answers, or visitor identifiers.
export const askLocalUsageTable = pgTable("ask_local_daily_usage", {
  day: date("day", { mode: "string" }).primaryKey(),
  attempts: integer("attempts").notNull(),
}, (table) => [
  check("ask_local_attempts_positive", sql`${table.attempts} > 0`),
]);

export const insertAskLocalUsageSchema = createInsertSchema(askLocalUsageTable);
export type InsertAskLocalUsage = z.infer<typeof insertAskLocalUsageSchema>;
export type AskLocalUsage = typeof askLocalUsageTable.$inferSelect;

// Durable outbox: aggregate snapshots only, never addresses or visitor data.
export const askLocalUsageAlertsTable = pgTable("ask_local_usage_alerts", {
  day: date("day", { mode: "string" }).notNull(),
  threshold: integer("threshold").notNull(),
  attempts: integer("attempts").notNull(),
  allowance: integer("allowance").notNull(),
  status: text("status").notNull().default("pending"),
  firstAttemptAt: timestamp("first_attempt_at", { withTimezone: true }),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.day, table.threshold] }),
  check("ask_local_alert_threshold", sql`${table.threshold} IN (80, 100)`),
  check("ask_local_alert_counts", sql`${table.attempts} > 0 AND ${table.allowance} > 0`),
  check("ask_local_alert_status", sql`${table.status} IN ('pending', 'sent', 'expired')`),
]);

export const insertAskLocalUsageAlertSchema = createInsertSchema(askLocalUsageAlertsTable);
export type InsertAskLocalUsageAlert = z.infer<typeof insertAskLocalUsageAlertSchema>;
export type AskLocalUsageAlert = typeof askLocalUsageAlertsTable.$inferSelect;
