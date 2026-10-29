import { and, eq, gte, isNull, lt } from "drizzle-orm";
import { DateTime } from "luxon";
import { fmtTime, formatRange } from "../bot/format.js";
import type { Db } from "../db/index.js";
import { blocks, items, users, type User } from "../db/schema.js";
import { replan } from "../scheduler/replan.js";
import { fromIso, logMessage, toIso, updateUser } from "../store.js";
import type { Messenger } from "../whatsapp/client.js";

/** Remind people this long before a session or event starts. */
export const REMINDER_LEAD_MIN = 10;
/** Free-form messages are allowed for 24h after the user's last message; keep a margin. */
const SERVICE_WINDOW_MIN = 24 * 60 - 10;
/** Don't send a morning summary that's this late (e.g. after the server was down all morning). */
const SUMMARY_CUTOFF_HOUR = 12;

export interface NotifierOptions {
  db: Db;
  messenger: Messenger;
  publicUrl: string | null;
  summaryTemplate: string;
  reminderTemplate: string;
}

export function inServiceWindow(user: User, now: DateTime): boolean {
  if (!user.lastInboundAt) return false;
  return now.diff(DateTime.fromISO(user.lastInboundAt), "minutes").minutes < SERVICE_WINDOW_MIN;
}

export class Notifier {
  private timer: NodeJS.Timeout | null = null;

  constructor(private opts: NotifierOptions) {}

  start(intervalMs = 60_000): void {
    const run = () => this.tick().catch((err) => console.error("notifier tick failed:", err));
    this.timer = setInterval(run, intervalMs);
    void run();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(now: DateTime = DateTime.utc()): Promise<void> {
    for (const user of this.opts.db.select().from(users).all()) {
      await this.morningSummary(user, now);
      if (user.remindersOn) await this.reminders(user, now);
    }
  }

  /**
   * Sends free-form text inside the 24h service window, otherwise the approved template.
   * Returns false if the message couldn't be sent at all.
   */
  private async send(user: User, now: DateTime, text: string, template: string, params: string[]): Promise<boolean> {
    try {
      if (inServiceWindow(user, now)) {
        await this.opts.messenger.sendText(user.phone, text);
      } else if (template) {
        await this.opts.messenger.sendTemplate(user.phone, template, params);
      } else {
        return false;
      }
      logMessage(this.opts.db, user.id, "out", text);
      return true;
    } catch (err) {
      console.error(`failed to message user ${user.id}:`, err);
      return false;
    }
  }

  private async morningSummary(user: User, now: DateTime): Promise<void> {
    if (!user.summaryTime) return;
    const local = now.setZone(user.timezone);
    const today = local.toISODate()!;
    if (user.lastSummaryDate === today || local.toFormat("HH:mm") < user.summaryTime) return;
    if (local.hour >= SUMMARY_CUTOFF_HOUR) return;

    // Mark first so a failing send doesn't retry every minute all morning.
    updateUser(this.opts.db, user.id, { lastSummaryDate: today });
    replan(this.opts.db, user, now);
    const plan = formatRange(this.opts.db, user, "today", now, this.opts.publicUrl);
    const text = `☀️ Good morning! Here's your day:\n\n${plan}\n\nReply _done_, _skip_ or _push_ as you go, or tell me about anything new.`;
    await this.send(user, now, text, this.opts.summaryTemplate, [plan]);
  }

  private async reminders(user: User, now: DateTime): Promise<void> {
    const { db } = this.opts;
    const from = toIso(now);
    const to = toIso(now.plus({ minutes: REMINDER_LEAD_MIN }));

    const sessions = db
      .select({ id: blocks.id, startAt: blocks.startAt, title: items.title })
      .from(blocks)
      .innerJoin(items, eq(items.id, blocks.itemId))
      .where(
        and(
          eq(blocks.userId, user.id),
          eq(blocks.status, "planned"),
          eq(items.status, "active"),
          isNull(blocks.remindedAt),
          gte(blocks.startAt, from),
          lt(blocks.startAt, to),
        ),
      )
      .all();
    const events = db
      .select()
      .from(items)
      .where(
        and(
          eq(items.userId, user.id),
          eq(items.kind, "event"),
          eq(items.status, "active"),
          isNull(items.remindedAt),
          gte(items.startAt, from),
          lt(items.startAt, to),
        ),
      )
      .all();

    for (const s of sessions) {
      db.update(blocks).set({ remindedAt: from }).where(eq(blocks.id, s.id)).run();
      const at = fmtTime(fromIso(s.startAt, user.timezone));
      await this.send(user, now, `⏰ *${s.title}* at ${at}. Reply _done_, _skip_ or _push_.`, this.opts.reminderTemplate, [
        s.title,
        at,
      ]);
    }
    for (const e of events) {
      db.update(items).set({ remindedAt: from }).where(eq(items.id, e.id)).run();
      const at = fmtTime(fromIso(e.startAt!, user.timezone));
      await this.send(user, now, `⏰ *${e.title}* at ${at}.`, this.opts.reminderTemplate, [e.title, at]);
    }
  }
}
