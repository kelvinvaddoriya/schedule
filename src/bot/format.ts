import { DateTime } from "luxon";
import type { DbLike as Db } from "../db/index.js";
import type { Item, User } from "../db/schema.js";
import { activeItems, entriesBetween, fromIso, type Entry } from "../store.js";

export type Range = "today" | "tomorrow" | "week";

export function fmtTime(t: DateTime): string {
  return t.toFormat("HH:mm");
}

export function fmtWhen(start: DateTime, end: DateTime): string {
  return `${start.toFormat("ccc d LLL")}, ${fmtTime(start)}–${fmtTime(end)}`;
}

/** "YYYY-MM-DDTHH:mm" in local time, the format the parser reads and writes. */
export function localStamp(t: DateTime): string {
  return t.toFormat("yyyy-LL-dd'T'HH:mm");
}

function dayHeading(day: DateTime, today: DateTime): string {
  const label = day.toFormat("ccc d LLL");
  if (day.hasSame(today, "day")) return `*Today · ${label}*`;
  if (day.hasSame(today.plus({ days: 1 }), "day")) return `*Tomorrow · ${label}*`;
  return `*${label}*`;
}

function entryLine(e: Entry): string {
  const time = `${fmtTime(e.start)}–${fmtTime(e.end)}`;
  if (e.status === "event") return `📅 ${time} ${e.title}`;
  if (e.status === "done") return `✅ ${time} ${e.title}`;
  if (e.status === "skipped") return `⏭️ ~${time} ${e.title}~`;
  return `▫️ ${time} ${e.title}`;
}

export function formatDays(user: User, entries: Entry[], days: DateTime[], now: DateTime): string {
  const today = now.setZone(user.timezone).startOf("day");
  return days
    .map((day) => {
      const lines = entries.filter((e) => e.start.hasSame(day, "day")).map(entryLine);
      return [dayHeading(day, today), ...(lines.length ? lines : ["_Free_"])].join("\n");
    })
    .join("\n\n");
}

export function weekLink(user: User, publicUrl: string | null): string | null {
  return publicUrl ? `${publicUrl}/w/${user.webToken}` : null;
}

/** Renders the plan for a range as a WhatsApp message. */
export function formatRange(db: Db, user: User, range: Range, now: DateTime, publicUrl: string | null): string {
  const today = now.setZone(user.timezone).startOf("day");
  const first = range === "tomorrow" ? today.plus({ days: 1 }) : today;
  const count = range === "week" ? 7 : 1;
  const days = Array.from({ length: count }, (_, i) => first.plus({ days: i }));
  const entries = entriesBetween(db, user, first, first.plus({ days: count }));
  let text = formatDays(user, entries, days, now);
  const link = weekLink(user, publicUrl);
  if (range === "week" && link) text += `\n\n🗓️ Full view: ${link}`;
  return text;
}

function describeItem(item: Item, zone: string): string {
  if (item.kind === "event") {
    return `#${item.id} event "${item.title}": ${localStamp(fromIso(item.startAt!, zone))} to ${localStamp(fromIso(item.endAt!, zone))}`;
  }
  const parts = [
    `${item.durationMin ?? 60} min`,
    item.recurring ? `${item.sessions ?? 1}x per week` : `${item.sessions ?? 1} session(s) total`,
  ];
  if (item.window !== "any") parts.push(item.window);
  if (item.days !== "any") parts.push(item.days);
  if (item.deadline) parts.push(`deadline ${localStamp(fromIso(item.deadline, zone))}`);
  return `#${item.id} task "${item.title}": ${parts.join(", ")}`;
}

/** Snapshot of the user's planner, given to the parser so it can resolve dates and ids. */
export function describeState(db: Db, user: User, now: DateTime): string {
  const zone = user.timezone;
  const nowL = now.setZone(zone);
  const items = activeItems(db, user.id);
  const sessions = entriesBetween(db, user, nowL.startOf("day"), nowL.startOf("day").plus({ days: 8 })).filter(
    (e) => e.kind === "block",
  );
  return [
    `Now: ${nowL.toFormat("cccc d LLLL yyyy, HH:mm")} (${zone}). Local time: ${localStamp(nowL)}.`,
    `Settings: schedulable ${user.dayStart}–${user.dayEnd}, morning summary ${user.summaryTime ?? "off"}, reminders ${user.remindersOn ? "on" : "off"}.`,
    "",
    "Items:",
    ...(items.length ? items.map((i) => describeItem(i, zone)) : ["(none)"]),
    "",
    "Scheduled sessions, today through the next 7 days:",
    ...(sessions.length
      ? sessions.map((s) => `b${s.id} "${s.title}" (item #${s.itemId}): ${localStamp(s.start)} to ${fmtTime(s.end)}, ${s.status}`)
      : ["(none)"]),
  ].join("\n");
}

export const HELP_TEXT = `Here's what I can do 👇

*Plan* — just tell me what's on, in your own words:
• _gym 3x this week, evenings_
• _deep work every weekday morning, 3h_
• _dentist Thursday 4pm_
• _finish the report by Friday, about 4 hours_

*Check* — _today_, _tomorrow_, _week_
*Update* — _done_, _skip_, _push_ (next free slot), _move gym to 7am_, _cancel the dentist_
*Settings* — _my timezone is Europe/London_, _plan my days 9 to 6_, _morning summary at 7_, _reminders off_`;
