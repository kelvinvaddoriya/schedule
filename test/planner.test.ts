import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { plan, spread, type PlannerTask } from "../src/scheduler/planner.js";

const zone = "Asia/Kolkata";
const at = (iso: string) => DateTime.fromISO(iso, { zone });
// Monday 2 Nov 2026, 09:00 local.
const now = at("2026-11-02T09:00");
const weekEnd = at("2026-11-09T00:00");

function task(overrides: Partial<PlannerTask> = {}): PlannerTask {
  return {
    key: "t",
    durationMin: 60,
    sessionsNeeded: 1,
    window: "any",
    days: "any",
    notBefore: now,
    notAfter: weekEnd,
    ...overrides,
  };
}

const run = (tasks: PlannerTask[], busy: { start: DateTime; end: DateTime }[] = []) =>
  plan({ zone, dayStart: "08:00", dayEnd: "22:00", busy, tasks });

const stamps = (r: ReturnType<typeof run>) => r.placements.map((p) => p.start.toFormat("ccc HH:mm"));

describe("spread", () => {
  it("picks evenly spaced items", () => {
    expect(spread([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([2, 4, 6]);
    expect(spread([1, 2], 5)).toEqual([1, 2]);
  });
});

describe("plan", () => {
  it("spreads sessions across the week in the preferred window", () => {
    const r = run([task({ sessionsNeeded: 3, window: "evening" })]);
    expect(stamps(r)).toEqual(["Tue 17:00", "Thu 17:00", "Sat 17:00"]);
    expect(r.unplaced).toEqual([]);
  });

  it("works around busy time with a buffer", () => {
    const r = run([task({ window: "evening", notBefore: at("2026-11-03T00:00"), notAfter: at("2026-11-04T00:00") })], [
      { start: at("2026-11-03T16:30"), end: at("2026-11-03T18:00") },
    ]);
    expect(stamps(r)).toEqual(["Tue 18:15"]);
  });

  it("keeps morning work inside the user's day", () => {
    const r = run([task({ durationMin: 180, sessionsNeeded: 5, window: "morning", days: "weekdays" })]);
    expect(stamps(r)).toEqual(["Mon 09:00", "Tue 08:00", "Wed 08:00", "Thu 08:00", "Fri 08:00"]);
  });

  it("starts no earlier than now, rounded up to the slot grid", () => {
    const r = run([task({ notBefore: at("2026-11-02T09:07"), notAfter: at("2026-11-03T00:00") })]);
    expect(stamps(r)).toEqual(["Mon 09:15"]);
  });

  it("finishes before a deadline", () => {
    const r = run([task({ durationMin: 120, sessionsNeeded: 2, notAfter: at("2026-11-04T17:00") })]);
    expect(stamps(r)).toEqual(["Mon 09:00", "Wed 08:00"]);
  });

  it("only uses weekends when asked", () => {
    const r = run([task({ sessionsNeeded: 2, days: "weekends" })]);
    expect(stamps(r)).toEqual(["Sat 08:00", "Sun 08:00"]);
  });

  it("falls back to other times of day before doubling up", () => {
    // Every evening this week is taken.
    const busy = Array.from({ length: 7 }, (_, i) => ({
      start: at("2026-11-02T17:00").plus({ days: i }),
      end: at("2026-11-02T22:00").plus({ days: i }),
    }));
    const r = run([task({ sessionsNeeded: 2, window: "evening" })], busy);
    expect(r.placements).toHaveLength(2);
    expect(new Set(r.placements.map((p) => p.start.toISODate())).size).toBe(2);
  });

  it("doesn't double-book between tasks", () => {
    const r = run([task({ key: "a", notAfter: at("2026-11-03T00:00") }), task({ key: "b", notAfter: at("2026-11-03T00:00") })]);
    expect(stamps(r)).toEqual(["Mon 09:00", "Mon 10:15"]);
  });

  it("reports what doesn't fit", () => {
    const r = run([task({ durationMin: 15 * 60 })]);
    expect(r.placements).toEqual([]);
    expect(r.unplaced).toEqual([{ key: "t", missing: 1 }]);
  });

  it("skips days that already hold a session", () => {
    const r = run([
      task({ sessionsNeeded: 1, notAfter: at("2026-11-04T00:00"), occupiedDays: new Set(["2026-11-02"]) }),
    ]);
    expect(stamps(r)).toEqual(["Tue 08:00"]);
  });
});

describe("plan ordering", () => {
  it("lets flexible tasks fit around ones with a preferred window", () => {
    const day = { notBefore: at("2026-11-03T00:00"), notAfter: at("2026-11-04T00:00") };
    const r = run([
      task({ key: "report", durationMin: 120, ...day, notAfter: at("2026-11-03T20:00") }),
      task({ key: "deep", durationMin: 180, window: "morning", ...day }),
    ]);
    expect(r.placements.map((p) => `${p.key} ${p.start.toFormat("HH:mm")}`)).toEqual(["deep 08:00", "report 11:15"]);
  });
});
