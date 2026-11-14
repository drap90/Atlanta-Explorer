import { check, date, integer, pgTable } from "drizzle-orm/pg-core";
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
