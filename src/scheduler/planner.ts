import { DateTime } from "luxon";
import type { DayFilter, TimeWindow } from "../db/schema.js";

/** Gap kept around everything on the calendar so the plan stays realistic. */
export const BUFFER_MIN = 15;
/** Slots start on this grid (minutes). */
export const SLOT_STEP_MIN = 15;

export interface Interval {
  start: DateTime;
  end: DateTime;
}

export interface PlannerTask {
  /** Opaque key so callers can map placements back to their own records. */
  key: string;
  durationMin: number;
  sessionsNeeded: number;
  window: TimeWindow;
  days: DayFilter;
  notBefore: DateTime;
  notAfter: DateTime;
  /** Local dates (yyyy-MM-dd) that already hold a session of this task. */
  occupiedDays?: Set<string>;
  /** Take the earliest days instead of spreading sessions across the range. */
  earliest?: boolean;
}

export interface PlanInput {
  zone: string;
  /** Local "HH:mm" bounds of the schedulable day. */
  dayStart: string;
  dayEnd: string;
  busy: Interval[];
  tasks: PlannerTask[];
}

export interface Placement extends Interval {
  key: string;
}

export interface PlanResult {
  placements: Placement[];
  unplaced: { key: string; missing: number }[];
}

const WINDOW_HOURS: Record<Exclude<TimeWindow, "any">, [number, number]> = {
  morning: [0, 12],
  afternoon: [12, 17],
  evening: [17, 24],
};

function atTime(day: DateTime, hhmm: string): DateTime {
  const [h, m] = hhmm.split(":").map(Number);
  return day.set({ hour: h ?? 0, minute: m ?? 0, second: 0, millisecond: 0 });
}

function roundUp(t: DateTime): DateTime {
  const t0 = t.set({ second: 0, millisecond: 0 });
  const extra = t0.minute % SLOT_STEP_MIN;
  const rounded = extra === 0 ? t0 : t0.plus({ minutes: SLOT_STEP_MIN - extra });
  return rounded < t ? rounded.plus({ minutes: SLOT_STEP_MIN }) : rounded;
}

function maxDt(a: DateTime, b: DateTime) {
  return a > b ? a : b;
}
function minDt(a: DateTime, b: DateTime) {
  return a < b ? a : b;
}

function dayMatches(day: DateTime, filter: DayFilter): boolean {
  const weekend = day.weekday >= 6;
  return filter === "any" || (filter === "weekends" ? weekend : !weekend);
}

/** Local bounds of `window` on `day`, clipped to the user's day. */
export function windowBounds(day: DateTime, window: TimeWindow, dayStart: string, dayEnd: string): Interval {
  const start = atTime(day, dayStart);
  const end = dayEnd === "24:00" || dayEnd === "00:00" ? day.startOf("day").plus({ days: 1 }) : atTime(day, dayEnd);
  if (window === "any") return { start, end };
  const [h0, h1] = WINDOW_HOURS[window];
  return {
    start: maxDt(start, day.startOf("day").plus({ hours: h0 })),
    end: minDt(end, day.startOf("day").plus({ hours: h1 })),
  };
}

/** Earliest gap of `durationMin` inside `range` that avoids `busy` (which must be sorted by start). */
export function findGap(range: Interval, durationMin: number, busy: Interval[]): Interval | null {
  let cursor = roundUp(range.start);
  for (const b of busy) {
    const bStart = b.start.minus({ minutes: BUFFER_MIN });
    const bEnd = b.end.plus({ minutes: BUFFER_MIN });
    if (bEnd <= cursor) continue;
    if (bStart >= range.end) break;
    if (bStart.diff(cursor, "minutes").minutes >= durationMin) break;
    cursor = roundUp(maxDt(cursor, bEnd));
  }
  const end = cursor.plus({ minutes: durationMin });
  return end <= range.end ? { start: cursor, end } : null;
}

function sortedInsert(busy: Interval[], iv: Interval) {
  const i = busy.findIndex((b) => b.start > iv.start);
  if (i === -1) busy.push(iv);
  else busy.splice(i, 0, iv);
}

/** Picks `n` items spread evenly across `list` (e.g. 3 of 7 days → Tue, Thu, Sat). */
export function spread<T>(list: T[], n: number): T[] {
  if (n >= list.length) return [...list];
  const picked: T[] = [];
  for (let i = 0; i < n; i++) picked.push(list[Math.floor(((i + 0.5) * list.length) / n)]!);
  return picked;
}

function daysBetween(from: DateTime, to: DateTime): DateTime[] {
  const out: DateTime[] = [];
  for (let d = from.startOf("day"); d < to; d = d.plus({ days: 1 })) out.push(d);
  return out;
}

/**
 * Places task sessions into free time. Greedy, one task at a time (see the ordering
 * below); each task's sessions are spread across distinct days, at the earliest gap in
 * its preferred window. If that can't fit everything it relaxes to any time of day,
 * then to several sessions a day.
 */
export function plan(input: PlanInput): PlanResult {
  const busy = input.busy
    .map((b) => ({ start: b.start.setZone(input.zone), end: b.end.setZone(input.zone) }))
    .sort((a, b) => a.start.toMillis() - b.start.toMillis());
  const placements: Placement[] = [];
  const unplaced: PlanResult["unplaced"] = [];

  // Tasks tied to a time of day or to certain days go first, since flexible ones can
  // fit around them; then the earliest hard limit, then the longest.
  const constrained = (t: PlannerTask) => (t.window !== "any" || t.days !== "any" ? 0 : 1);
  const tasks = [...input.tasks].sort(
    (a, b) =>
      constrained(a) - constrained(b) ||
      a.notAfter.toMillis() - b.notAfter.toMillis() ||
      b.durationMin - a.durationMin,
  );

  for (const task of tasks) {
    const notBefore = task.notBefore.setZone(input.zone);
    const notAfter = task.notAfter.setZone(input.zone);
    const used = new Set(task.occupiedDays ?? []);
    let missing = task.sessionsNeeded;

    const slotOn = (day: DateTime, window: TimeWindow): Interval | null => {
      const w = windowBounds(day, window, input.dayStart, input.dayEnd);
      const range = { start: maxDt(w.start, notBefore), end: minDt(w.end, notAfter) };
      if (range.end <= range.start) return null;
      return findGap(range, task.durationMin, busy);
    };
    const place = (slot: Interval) => {
      placements.push({ key: task.key, ...slot });
      sortedInsert(busy, slot);
      used.add(slot.start.toISODate()!);
      missing--;
    };

    const days = daysBetween(notBefore, notAfter).filter((d) => dayMatches(d, task.days));
    const passes: { window: TimeWindow; onePerDay: boolean }[] = [
      { window: task.window, onePerDay: true },
      { window: "any", onePerDay: true },
      { window: task.window, onePerDay: false },
      { window: "any", onePerDay: false },
    ];

    for (const pass of passes) {
      if (missing <= 0) break;
      if (pass.onePerDay) {
        // Find a slot on each free day first, then choose evenly spaced days among them.
        const candidates = days
          .filter((d) => !used.has(d.toISODate()!))
          .map((d) => slotOn(d, pass.window))
          .filter((s): s is Interval => s !== null);
        const chosen = task.earliest ? candidates.slice(0, missing) : spread(candidates, missing);
        for (const slot of chosen) place(slot);
      } else {
        for (const day of days) {
          let slot: Interval | null;
          while (missing > 0 && (slot = slotOn(day, pass.window))) place(slot);
          if (missing <= 0) break;
        }
      }
    }

    if (missing > 0) unplaced.push({ key: task.key, missing });
  }

  placements.sort((a, b) => a.start.toMillis() - b.start.toMillis());
  return { placements, unplaced };
}
