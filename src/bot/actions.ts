import { and, eq, gte, ne } from "drizzle-orm";
import { DateTime } from "luxon";
import type { DbLike as Db } from "../db/index.js";
import { blocks, items, type Block, type Item, type User } from "../db/schema.js";
import type { Intent } from "../nlu/intents.js";
import { DEFAULT_DURATION_MIN, horizonEnd, pushBlock } from "../scheduler/replan.js";
import { entriesBetween, getBlock, getItem, toIso, updateUser, fromIso } from "../store.js";
import { fmtWhen, HELP_TEXT, type Range } from "./format.js";

export interface ActionResult {
  lines: string[];
  /** The plan needs rebuilding. */
  replan: boolean;
  /** Show this range after the action. */
  show?: Range;
}

const nothing = (line: string): ActionResult => ({ lines: [line], replan: false });

function parseLocal(value: string | null, zone: string): DateTime | null {
  if (!value) return null;
  const t = DateTime.fromISO(value, { zone });
  return t.isValid ? t : null;
}

function isHhmm(v: string): boolean {
  return /^([01]\d|2[0-4]):[0-5]\d$/.test(v);
}

function describeTask(i: Pick<Item, "durationMin" | "sessions" | "recurring" | "window" | "days">): string {
  const parts = [`${i.durationMin} min`];
  const n = i.sessions ?? 1;
  parts.push(i.recurring ? `${n}× a week` : n > 1 ? `${n} sessions` : "once");
  if (i.window !== "any") parts.push(i.window === "morning" ? "mornings" : i.window === "afternoon" ? "afternoons" : "evenings");
  if (i.days !== "any") parts.push(i.days);
  return parts.join(", ");
}

/**
 * The session a bare "done" / "skip" / "push" refers to: the one happening now, else the
 * latest unfinished one earlier today, else the next one coming up.
 */
function resolveBlock(db: Db, user: User, it: Intent, now: DateTime): Block | undefined {
  if (it.block_id) return getBlock(db, user.id, it.block_id);
  const nowL = now.setZone(user.timezone);
  const sessions = entriesBetween(db, user, nowL.startOf("day"), horizonEnd(now, user.timezone)).filter(
    (e) => e.kind === "block" && e.status === "planned" && (!it.item_id || e.itemId === it.item_id),
  );
  const current =
    sessions.find((e) => e.start <= nowL && e.end > nowL) ??
    sessions.filter((e) => e.end <= nowL).at(-1) ??
    sessions.find((e) => e.start > nowL);
  return current ? getBlock(db, user.id, current.id) : undefined;
}

function itemTitle(db: Db, userId: number, itemId: number): string {
  return getItem(db, userId, itemId)?.title ?? "that";
}

export function applyIntent(db: Db, user: User, it: Intent, now: DateTime): ActionResult {
  const zone = user.timezone;

  switch (it.type) {
    case "help":
      return { lines: [HELP_TEXT], replan: false };

    case "show":
      return { lines: [], replan: false, show: it.range ?? "week" };

    case "add_event": {
      const start = parseLocal(it.start, zone);
      if (!it.title || !start) return nothing("I couldn't work out when that event is. Could you give me a day and time?");
      const end = parseLocal(it.end, zone) ?? start.plus({ minutes: it.duration_minutes ?? 60 });
      if (end <= start) return nothing(`The end time for *${it.title}* is before it starts. Can you check the times?`);
      db.insert(items).values({ userId: user.id, kind: "event", title: it.title, startAt: toIso(start), endAt: toIso(end) }).run();
      return { lines: [`📅 Added *${it.title}* — ${fmtWhen(start, end)}`], replan: true, show: "week" };
    }

    case "add_task": {
      if (!it.title) return nothing("What should I call that task?");
      const task = {
        durationMin: Math.max(15, it.duration_minutes ?? DEFAULT_DURATION_MIN),
        sessions: Math.max(1, it.sessions ?? 1),
        recurring: it.recurring_weekly ?? false,
        window: it.window ?? "any",
        days: it.days ?? "any",
      } as const;
      const deadline = parseLocal(it.deadline, zone);
      db.insert(items)
        .values({ userId: user.id, kind: "task", title: it.title, ...task, deadline: deadline ? toIso(deadline) : null })
        .run();
      const due = deadline ? `, due ${deadline.toFormat("ccc d LLL HH:mm")}` : "";
      return { lines: [`📝 Added *${it.title}* — ${describeTask(task)}${due}`], replan: true, show: "week" };
    }

    case "update_item": {
      const item = it.item_id ? getItem(db, user.id, it.item_id) : undefined;
      if (!item) return nothing("I couldn't tell which item to change.");
      const patch: Partial<Item> = {};
      if (it.title) patch.title = it.title;
      if (item.kind === "event") {
        const start = parseLocal(it.start, zone);
        const end = parseLocal(it.end, zone);
        const oldStart = fromIso(item.startAt!, zone);
        const length = fromIso(item.endAt!, zone).diff(oldStart);
        const newStart = start ?? oldStart;
        const newEnd = end ?? (it.duration_minutes ? newStart.plus({ minutes: it.duration_minutes }) : newStart.plus(length));
        if (newEnd <= newStart) return nothing("That would make the event end before it starts.");
        patch.startAt = toIso(newStart);
        patch.endAt = toIso(newEnd);
      } else {
        if (it.duration_minutes) patch.durationMin = Math.max(15, it.duration_minutes);
        if (it.sessions) patch.sessions = Math.max(1, it.sessions);
        if (it.recurring_weekly !== null) patch.recurring = it.recurring_weekly;
        if (it.window) patch.window = it.window;
        if (it.days) patch.days = it.days;
        const deadline = parseLocal(it.deadline, zone);
        if (deadline) patch.deadline = toIso(deadline);
      }
      db.update(items).set(patch).where(eq(items.id, item.id)).run();
      // Sessions placed for the old settings no longer apply.
      if (item.kind === "task") {
        db.delete(blocks)
          .where(and(eq(blocks.itemId, item.id), eq(blocks.status, "planned"), gte(blocks.startAt, toIso(now))))
          .run();
      }
      return { lines: [`✏️ Updated *${patch.title ?? item.title}*`], replan: true, show: "week" };
    }

    case "delete_item": {
      const item = it.item_id ? getItem(db, user.id, it.item_id) : undefined;
      if (!item) return nothing("I couldn't tell which item to remove.");
      db.update(items).set({ status: "deleted" }).where(eq(items.id, item.id)).run();
      db.delete(blocks)
        .where(and(eq(blocks.itemId, item.id), ne(blocks.status, "done"), gte(blocks.startAt, toIso(now))))
        .run();
      return { lines: [`🗑️ Removed *${item.title}*`], replan: true };
    }

    case "move": {
      const start = parseLocal(it.start, zone);
      if (!start) return nothing("When should I move it to?");
      const item = it.item_id ? getItem(db, user.id, it.item_id) : undefined;
      if (item?.kind === "event" && !it.block_id) {
        const oldStart = fromIso(item.startAt!, zone);
        const end = parseLocal(it.end, zone) ?? start.plus(fromIso(item.endAt!, zone).diff(oldStart));
        db.update(items).set({ startAt: toIso(start), endAt: toIso(end), remindedAt: null }).where(eq(items.id, item.id)).run();
        return { lines: [`➡️ Moved *${item.title}* to ${fmtWhen(start, end)}`], replan: true };
      }
      const block = it.block_id ? getBlock(db, user.id, it.block_id) : resolveBlock(db, user, it, now);
      if (!block) return nothing("I couldn't tell which session to move.");
      const length = fromIso(block.endAt, zone).diff(fromIso(block.startAt, zone));
      const end = parseLocal(it.end, zone) ?? start.plus(length);
      db.update(blocks)
        .set({ startAt: toIso(start), endAt: toIso(end), pinned: true, status: "planned", remindedAt: null })
        .where(eq(blocks.id, block.id))
        .run();
      return { lines: [`➡️ Moved *${itemTitle(db, user.id, block.itemId)}* to ${fmtWhen(start, end)}`], replan: true };
    }

    case "push": {
      const block = resolveBlock(db, user, it, now);
      if (!block) return nothing("There's nothing coming up to push.");
      const title = itemTitle(db, user.id, block.itemId);
      const moved = pushBlock(db, user, block, now);
      if (!moved) return nothing(`I couldn't find a later free slot for *${title}*.`);
      return {
        lines: [`⏩ Pushed *${title}* to ${fmtWhen(fromIso(moved.startAt, zone), fromIso(moved.endAt, zone))}`],
        replan: true,
      };
    }

    case "done":
    case "skip": {
      const block = resolveBlock(db, user, it, now);
      if (!block) return nothing(it.type === "done" ? "Nice! (There was no session to tick off.)" : "There's nothing to skip right now.");
      const status = it.type === "done" ? "done" : "skipped";
      db.update(blocks).set({ status }).where(eq(blocks.id, block.id)).run();
      const item = getItem(db, user.id, block.itemId);
      const title = item?.title ?? "that";
      if (item && status === "done" && !item.recurring) {
        const doneCount = db
          .select()
          .from(blocks)
          .where(and(eq(blocks.itemId, item.id), eq(blocks.status, "done")))
          .all().length;
        if (doneCount >= (item.sessions ?? 1)) {
          db.update(items).set({ status: "done" }).where(eq(items.id, item.id)).run();
          return { lines: [`🎉 *${title}* is complete!`], replan: true };
        }
      }
      return {
        lines: [status === "done" ? `✅ Nice work — *${title}* done.` : `⏭️ Skipped *${title}*.`],
        replan: status === "skipped",
      };
    }

    case "set_preferences": {
      const patch: Partial<User> = {};
      const changes: string[] = [];
      if (it.timezone) {
        if (!DateTime.now().setZone(it.timezone).isValid) return nothing(`I don't recognise the timezone "${it.timezone}".`);
        patch.timezone = it.timezone;
        changes.push(`timezone ${it.timezone}`);
      }
      if (it.day_start && isHhmm(it.day_start)) patch.dayStart = it.day_start;
      if (it.day_end && isHhmm(it.day_end)) patch.dayEnd = it.day_end;
      if (patch.dayStart || patch.dayEnd) {
        const s = patch.dayStart ?? user.dayStart;
        const e = patch.dayEnd ?? user.dayEnd;
        if (e <= s) return nothing("Your day needs to end after it starts.");
        changes.push(`days planned ${s}–${e}`);
      }
      if (it.summary_time) {
        if (it.summary_time === "off") {
          patch.summaryTime = null;
          changes.push("morning summary off");
        } else if (isHhmm(it.summary_time)) {
          patch.summaryTime = it.summary_time;
          changes.push(`morning summary at ${it.summary_time}`);
        }
      }
      if (it.reminders !== null) {
        patch.remindersOn = it.reminders;
        changes.push(`reminders ${it.reminders ? "on" : "off"}`);
      }
      if (!changes.length) return nothing("I didn't catch which setting to change.");
      Object.assign(user, updateUser(db, user.id, patch));
      return {
        lines: [`⚙️ Updated: ${changes.join(", ")}.`],
        replan: Boolean(patch.timezone || patch.dayStart || patch.dayEnd),
      };
    }
  }
}
