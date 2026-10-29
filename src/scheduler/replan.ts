import { and, eq, gte } from "drizzle-orm";
import { DateTime } from "luxon";
import type { DbLike as Db } from "../db/index.js";
import { blocks, items, type Block, type Item, type User } from "../db/schema.js";
import { blocksForItems, entriesBetween, fromIso, toIso } from "../store.js";
import { plan, type Interval, type PlannerTask } from "./planner.js";

export const DEFAULT_DURATION_MIN = 60;

/** The planner looks ahead to the end of next calendar week. */
export function horizonEnd(now: DateTime, zone: string): DateTime {
  return now.setZone(zone).startOf("week").plus({ weeks: 2 });
}

function busyIntervals(db: Db, user: User, from: DateTime, to: DateTime): Interval[] {
  return entriesBetween(db, user, from, to)
    .filter((e) => e.status !== "skipped")
    .map((e) => ({ start: e.start, end: e.end }));
}

export interface ReplanResult {
  placed: number;
  unplaced: { item: Item; missing: number }[];
}

/**
 * Rebuilds the user's future plan. Blocks the user has acted on (done, skipped, pinned)
 * and anything in the past are kept; every other future block is thrown away and the
 * remaining sessions are placed again around events and kept blocks.
 */
export function replan(db: Db, user: User, now: DateTime = DateTime.utc()): ReplanResult {
  const zone = user.timezone;
  const nowL = now.setZone(zone);
  const end = horizonEnd(now, zone);

  return db.transaction((tx) => {
    tx.delete(blocks)
      .where(
        and(
          eq(blocks.userId, user.id),
          eq(blocks.status, "planned"),
          eq(blocks.pinned, false),
          gte(blocks.startAt, toIso(now)),
        ),
      )
      .run();

    const tasks = tx
      .select()
      .from(items)
      .where(and(eq(items.userId, user.id), eq(items.kind, "task"), eq(items.status, "active")))
      .all();
    const kept = blocksForItems(tx, tasks.map((t) => t.id));

    const plannerTasks: PlannerTask[] = [];
    const itemByKey = new Map<string, Item>();
    const unplaced: ReplanResult["unplaced"] = [];

    for (const task of tasks) {
      const mine = kept.filter((b) => b.itemId === task.id);
      const sessions = task.sessions ?? 1;
      const deadline = task.deadline ? fromIso(task.deadline, zone) : null;

      // Recurring tasks are planned per calendar week; one-off work by its deadline, or
      // within the coming week if it has none.
      const oneOffEnd = !deadline ? nowL.plus({ days: 7 }) : deadline < end ? deadline : end;
      const periods: { start: DateTime | null; end: DateTime; key: string }[] = task.recurring
        ? [0, 1].map((w) => {
            const start = nowL.startOf("week").plus({ weeks: w });
            return { start, end: start.plus({ weeks: 1 }), key: `${task.id}:w${w}` };
          })
        : [{ start: null, end: oneOffEnd, key: `${task.id}` }];

      for (const period of periods) {
        const inPeriod = period.start
          ? mine.filter((b) => {
              const s = fromIso(b.startAt, zone);
              return s >= period.start! && s < period.end;
            })
          : mine;
        const needed = sessions - inPeriod.length;
        if (needed <= 0) continue;

        const notBefore = period.start && period.start > nowL ? period.start : nowL;
        if (period.end <= notBefore) {
          // Only a deadline can end a period before now.
          unplaced.push({ item: task, missing: needed });
          continue;
        }
        itemByKey.set(period.key, task);
        plannerTasks.push({
          key: period.key,
          durationMin: task.durationMin ?? DEFAULT_DURATION_MIN,
          sessionsNeeded: needed,
          window: task.window,
          days: task.days,
          notBefore,
          notAfter: period.end,
          // A lone session goes in the first free slot; several are spread out.
          earliest: !task.recurring && sessions === 1,
          occupiedDays: new Set(
            mine.filter((b) => b.status !== "skipped").map((b) => fromIso(b.startAt, zone).toISODate()!),
          ),
        });
      }
    }

    const result = plan({
      zone,
      dayStart: user.dayStart,
      dayEnd: user.dayEnd,
      busy: busyIntervals(tx, user, now, end),
      tasks: plannerTasks,
    });

    for (const p of result.placements) {
      tx.insert(blocks)
        .values({ userId: user.id, itemId: itemByKey.get(p.key)!.id, startAt: toIso(p.start), endAt: toIso(p.end) })
        .run();
    }

    for (const u of result.unplaced) {
      const item = itemByKey.get(u.key)!;
      // Sessions for a far-off deadline may simply not fit in the horizon yet; don't warn about those.
      const deadline = item.deadline ? fromIso(item.deadline, zone) : null;
      if (!item.recurring && deadline && deadline > end) continue;
      const existing = unplaced.find((x) => x.item.id === item.id);
      if (existing) existing.missing += u.missing;
      else unplaced.push({ item, missing: u.missing });
    }

    return { placed: result.placements.length, unplaced };
  });
}

/**
 * Moves a block to the next free slot after it ends (or after now, if later) and pins
 * it there. Returns the new block, or null if nothing fits before the horizon.
 */
export function pushBlock(db: Db, user: User, block: Block, now: DateTime = DateTime.utc()): Block | null {
  const zone = user.timezone;
  const item = db.select().from(items).where(eq(items.id, block.itemId)).get();
  if (!item) return null;
  const end = horizonEnd(now, zone).plus({ weeks: 1 });
  const blockEnd = fromIso(block.endAt, zone);
  const after = blockEnd > now ? blockEnd : now.setZone(zone);
  const durationMin = fromIso(block.endAt, zone).diff(fromIso(block.startAt, zone), "minutes").minutes;

  return db.transaction((tx) => {
    tx.delete(blocks).where(eq(blocks.id, block.id)).run();
    const result = plan({
      zone,
      dayStart: user.dayStart,
      dayEnd: user.dayEnd,
      busy: busyIntervals(tx, user, now, end),
      tasks: [
        {
          key: "push",
          durationMin,
          sessionsNeeded: 1,
          // "Later" means the soonest free time, even outside the usual window.
          window: "any",
          days: item.days,
          notBefore: after,
          notAfter: end,
          earliest: true,
        },
      ],
    });
    const slot = result.placements[0];
    if (!slot) {
      tx.insert(blocks).values(block).run();
      return null;
    }
    return tx
      .insert(blocks)
      .values({ userId: user.id, itemId: item.id, startAt: toIso(slot.start), endAt: toIso(slot.end), pinned: true })
      .returning()
      .get();
  });
}
