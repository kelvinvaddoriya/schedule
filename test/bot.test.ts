import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { blocks, items } from "../src/db/schema.js";
import { intent } from "../src/nlu/intents.js";
import { fromIso } from "../src/store.js";
import { at, PHONE, setup, ZONE } from "./helpers.js";

const monday = at("2026-11-02T09:00");

const weekPlan = {
  intents: [
    intent("add_task", { title: "Gym", duration_minutes: 60, sessions: 3, recurring_weekly: true, window: "evening" }),
    intent("add_task", {
      title: "Deep work",
      duration_minutes: 180,
      sessions: 5,
      recurring_weekly: true,
      window: "morning",
      days: "weekdays",
    }),
    intent("add_event", { title: "Dentist", start: "2026-11-05T16:00", end: "2026-11-05T17:00" }),
    intent("add_task", { title: "Report", duration_minutes: 120, sessions: 2, deadline: "2026-11-06T17:00" }),
  ],
  reply: null,
};

function sessionsOf(db: ReturnType<typeof setup>["db"], title: string) {
  const item = db.select().from(items).where(eq(items.title, title)).get()!;
  return db
    .select()
    .from(blocks)
    .where(eq(blocks.itemId, item.id))
    .all()
    .map((b) => ({ ...b, local: fromIso(b.startAt, ZONE).toFormat("ccc d HH:mm") }))
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
}

describe("Bot", () => {
  it("welcomes new users", async () => {
    const { bot } = setup();
    const reply = await bot.handle({ phone: PHONE, text: "hi", name: "Asha", now: monday });
    expect(reply).toContain("Hi Asha");
    expect(reply).toContain("Asia/Kolkata");
    expect(reply).toContain("Here's what I can do");
  });

  it("turns a week description into a plan", async () => {
    const { bot, db, parser } = setup([weekPlan]);
    const reply = await bot.handle({ phone: PHONE, text: "gym 3x a week...", now: monday });

    expect(reply).toContain("📝 Added *Gym* — 60 min, 3× a week, evenings");
    expect(reply).toContain("📅 Added *Dentist* — Thu 5 Nov, 16:00–17:00");
    expect(reply).toContain("*Today · Mon 2 Nov*");
    expect(reply).toContain("https://plan.example/w/");
    expect(parser.calls[0]!.state).toContain("Monday 2 November 2026, 09:00 (Asia/Kolkata)");

    // This week and next week are both planned for recurring tasks.
    expect(sessionsOf(db, "Gym")).toHaveLength(6);
    expect(sessionsOf(db, "Deep work")).toHaveLength(10);
    expect(sessionsOf(db, "Report").map((s) => s.local)).toHaveLength(2);
    expect(sessionsOf(db, "Gym").slice(0, 3).map((s) => s.local)).toEqual(["Tue 3 17:00", "Thu 5 17:15", "Sat 7 17:00"]);
  });

  it("never schedules on top of an event", async () => {
    const { bot, db } = setup([weekPlan]);
    await bot.handle({ phone: PHONE, text: "here is my week", now: monday });
    const dentist = { start: at("2026-11-05T16:00"), end: at("2026-11-05T17:00") };
    for (const b of db.select().from(blocks).all()) {
      const s = fromIso(b.startAt, "utc");
      const e = fromIso(b.endAt, "utc");
      expect(e <= dentist.start || s >= dentist.end).toBe(true);
    }
  });

  it("handles quick commands without calling the parser", async () => {
    const { bot, parser } = setup([weekPlan]);
    await bot.handle({ phone: PHONE, text: "plan my week", now: monday });
    const reply = await bot.handle({ phone: PHONE, text: "Today", now: monday });
    expect(parser.calls).toHaveLength(1);
    expect(reply).toContain("*Today · Mon 2 Nov*");
    expect(reply).toContain("Deep work");
  });

  it("marks the current session done", async () => {
    const { bot, db } = setup([weekPlan]);
    await bot.handle({ phone: PHONE, text: "here is my week", now: monday });
    const first = sessionsOf(db, "Deep work")[0]!;
    expect(first.local).toBe("Mon 2 09:00");

    const reply = await bot.handle({ phone: PHONE, text: "done", now: at("2026-11-02T10:30") });
    expect(reply).toBe("✅ Nice work — *Deep work* done.");
    expect(sessionsOf(db, "Deep work")[0]!.status).toBe("done");
  });

  it("completes a one-off task when its last session is done", async () => {
    const { bot, db } = setup([weekPlan]);
    await bot.handle({ phone: PHONE, text: "here is my week", now: monday });
    const [a, b] = sessionsOf(db, "Report");
    await bot.handle({ phone: PHONE, text: "done", now: fromIso(a!.endAt, "utc") });
    const reply = await bot.handle({ phone: PHONE, text: "done", now: fromIso(b!.endAt, "utc") });
    expect(reply).toBe("🎉 *Report* is complete!");
    expect(db.select().from(items).where(eq(items.title, "Report")).get()!.status).toBe("done");
  });

  it("keeps a moved session where the user put it", async () => {
    const { bot, db, parser } = setup([weekPlan]);
    await bot.handle({ phone: PHONE, text: "here is my week", now: monday });
    const gym = sessionsOf(db, "Gym")[0]!;

    parser.push({ intents: [intent("move", { block_id: gym.id, start: "2026-11-03T07:00" })], reply: null });
    const reply = await bot.handle({ phone: PHONE, text: "move gym to 7am", now: monday });
    expect(reply).toBe("➡️ Moved *Gym* to Tue 3 Nov, 07:00–08:00");

    // Adding something else replans everything that isn't pinned.
    parser.push({ intents: [intent("add_task", { title: "Call mum", duration_minutes: 30 })], reply: null });
    await bot.handle({ phone: PHONE, text: "call mum this week", now: monday });
    const moved = sessionsOf(db, "Gym").find((s) => s.id === gym.id)!;
    expect(moved.local).toBe("Tue 3 07:00");
    expect(moved.pinned).toBe(true);
    // The moved session still counts toward this week's three.
    expect(sessionsOf(db, "Gym").filter((s) => s.startAt < at("2026-11-09T00:00").toISO()!)).toHaveLength(3);
  });

  it("doesn't re-plan a one-off session the user moved far ahead", async () => {
    const { bot, db, parser } = setup([
      { intents: [intent("add_task", { title: "Call bank", duration_minutes: 30 })], reply: null },
    ]);
    await bot.handle({ phone: PHONE, text: "call the bank", now: monday });
    const [only] = sessionsOf(db, "Call bank");
    parser.push(
      { intents: [intent("move", { block_id: only!.id, start: "2026-11-13T10:00" })], reply: null },
      { intents: [intent("add_task", { title: "Groceries", duration_minutes: 45 })], reply: null },
    );
    await bot.handle({ phone: PHONE, text: "move it to the 13th", now: monday });
    await bot.handle({ phone: PHONE, text: "groceries", now: monday });
    expect(sessionsOf(db, "Call bank").map((s) => s.local)).toEqual(["Fri 13 10:00"]);
  });

  it("pushes a session to the next free slot", async () => {
    const { bot, db } = setup([weekPlan]);
    await bot.handle({ phone: PHONE, text: "here is my week", now: monday });
    const reply = await bot.handle({ phone: PHONE, text: "push", now: at("2026-11-02T09:05") });
    expect(reply).toMatch(/^⏩ Pushed \*Deep work\* to Mon 2 Nov, 12:00–15:00$/);
    expect(sessionsOf(db, "Deep work")[0]!.pinned).toBe(true);
  });

  it("warns about sessions that can't fit", async () => {
    const { bot } = setup([
      {
        intents: [intent("add_task", { title: "Thesis", duration_minutes: 600, sessions: 3, deadline: "2026-11-03T12:00" })],
        reply: null,
      },
    ]);
    const reply = await bot.handle({ phone: PHONE, text: "thesis", now: monday });
    expect(reply).toContain("⚠️ I couldn't fit 2 sessions of *Thesis*");
  });

  it("updates preferences", async () => {
    const { bot, parser } = setup();
    parser.push({ intents: [intent("set_preferences", { timezone: "Europe/London", summary_time: "off" })], reply: null });
    const reply = await bot.handle({ phone: PHONE, text: "I'm in London, no morning summaries", now: monday });
    expect(reply).toContain("⚙️ Updated: timezone Europe/London, morning summary off.");

    parser.push({ intents: [intent("set_preferences", { timezone: "Mars/Olympus" })], reply: null });
    expect(await bot.handle({ phone: PHONE, text: "mars time", now: monday })).toContain("don't recognise");
  });

  it("passes the parser's question through", async () => {
    const { bot } = setup([{ intents: [], reply: "Which day is the dentist?" }]);
    const reply = await bot.handle({ phone: PHONE, text: "add dentist", now: monday });
    expect(reply).toContain("Which day is the dentist?");
  });

  it("explains itself when no parser is configured", async () => {
    const { db } = setup();
    const { Bot } = await import("../src/bot/bot.js");
    const bot = new Bot(db, null, { defaultTimezone: ZONE, publicUrl: null });
    expect(await bot.handle({ phone: PHONE, text: "gym tomorrow", now: monday })).toContain("no Anthropic API key");
    expect(await bot.handle({ phone: PHONE, text: "week", now: monday })).toContain("_Free_");
  });
});
