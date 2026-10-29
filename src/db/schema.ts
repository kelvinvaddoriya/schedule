import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// All timestamps are stored as UTC ISO-8601 strings, so they sort and compare as text.

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  phone: text("phone").notNull().unique(),
  name: text("name"),
  timezone: text("timezone").notNull(),
  /** Local "HH:mm" bounds for when anything may be scheduled. */
  dayStart: text("day_start").notNull().default("08:00"),
  dayEnd: text("day_end").notNull().default("22:00"),
  /** Local "HH:mm" for the morning summary, or null to disable it. */
  summaryTime: text("summary_time").default("07:30"),
  remindersOn: integer("reminders_on", { mode: "boolean" }).notNull().default(true),
  /** Secret used in the read-only week view URL. */
  webToken: text("web_token").notNull().unique(),
  lastInboundAt: text("last_inbound_at"),
  /** Local date (yyyy-MM-dd) the last morning summary was sent. */
  lastSummaryDate: text("last_summary_date"),
  createdAt: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});

export type ItemKind = "event" | "task";
export type TimeWindow = "morning" | "afternoon" | "evening" | "any";
export type DayFilter = "any" | "weekdays" | "weekends";
export type ItemStatus = "active" | "done" | "deleted";

/**
 * Something the user wants in their week. Events have a fixed time; tasks have a
 * duration and a number of sessions that the planner places into free time.
 */
export const items = sqliteTable("items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").$type<ItemKind>().notNull(),
  title: text("title").notNull(),
  status: text("status").$type<ItemStatus>().notNull().default("active"),
  // Events
  startAt: text("start_at"),
  endAt: text("end_at"),
  remindedAt: text("reminded_at"),
  // Tasks
  durationMin: integer("duration_min"),
  sessions: integer("sessions"),
  /** If true, `sessions` repeats every calendar week (Mon–Sun). */
  recurring: integer("recurring", { mode: "boolean" }).notNull().default(false),
  window: text("window").$type<TimeWindow>().notNull().default("any"),
  days: text("days").$type<DayFilter>().notNull().default("any"),
  deadline: text("deadline"),
  createdAt: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});

export type BlockStatus = "planned" | "done" | "skipped";

/** A scheduled session of a task. */
export const blocks = sqliteTable("blocks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  itemId: integer("item_id")
    .notNull()
    .references(() => items.id, { onDelete: "cascade" }),
  startAt: text("start_at").notNull(),
  endAt: text("end_at").notNull(),
  status: text("status").$type<BlockStatus>().notNull().default("planned"),
  /** Pinned blocks were placed by the user and are never moved by the planner. */
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  remindedAt: text("reminded_at"),
});

/** Conversation log; also used to de-duplicate webhook retries. */
export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  direction: text("direction").$type<"in" | "out">().notNull(),
  body: text("body").notNull(),
  waMessageId: text("wa_message_id").unique(),
  createdAt: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});

export type User = typeof users.$inferSelect;
export type Item = typeof items.$inferSelect;
export type Block = typeof blocks.$inferSelect;
