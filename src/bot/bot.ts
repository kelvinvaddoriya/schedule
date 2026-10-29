import { DateTime } from "luxon";
import type { Db } from "../db/index.js";
import type { User } from "../db/schema.js";
import type { Intent, Parser } from "../nlu/intents.js";
import { replan } from "../scheduler/replan.js";
import { getOrCreateUser, logMessage, recentMessages, toIso, updateUser } from "../store.js";
import { applyIntent } from "./actions.js";
import { quickIntents } from "./commands.js";
import { describeState, formatRange, type Range } from "./format.js";

export interface BotOptions {
  defaultTimezone: string;
  publicUrl: string | null;
}

export interface Incoming {
  phone: string;
  text: string;
  name?: string | null;
  waMessageId?: string;
  now?: DateTime;
}

const HISTORY_TURNS = 6;

/** Transport-agnostic conversation logic: takes a message, updates the plan, returns the reply. */
export class Bot {
  constructor(
    private db: Db,
    private parser: Parser | null,
    private opts: BotOptions,
  ) {}

  async handle(msg: Incoming): Promise<string> {
    const now = msg.now ?? DateTime.utc();
    const { user, created } = getOrCreateUser(this.db, msg.phone, {
      name: msg.name,
      timezone: this.opts.defaultTimezone,
    });
    const history = recentMessages(this.db, user.id, HISTORY_TURNS);
    logMessage(this.db, user.id, "in", msg.text, msg.waMessageId);
    Object.assign(user, updateUser(this.db, user.id, { lastInboundAt: toIso(now) }));

    const reply = await this.respond(user, msg.text, history, now, created);
    logMessage(this.db, user.id, "out", reply);
    return reply;
  }

  private async respond(
    user: User,
    text: string,
    history: { direction: "in" | "out"; body: string }[],
    now: DateTime,
    created: boolean,
  ): Promise<string> {
    const welcome = created
      ? `👋 Hi${user.name ? ` ${user.name}` : ""}! I'm your weekly planner. Tell me what's on your plate and I'll fit it into your week.\n(I'm assuming your timezone is ${user.timezone} — tell me if it's different.)`
      : null;

    let intents: Intent[];
    let note: string | null = null;
    const quick = quickIntents(text);
    if (quick) {
      intents = quick;
    } else if (this.parser) {
      try {
        const parsed = await this.parser.parse({
          state: describeState(this.db, user, now),
          history: history.map((h) => ({ role: h.direction === "in" ? "user" : "bot", text: h.body })),
          message: text,
        });
        intents = parsed.intents;
        note = parsed.reply;
      } catch (err) {
        console.error("parser failed:", err);
        return join(welcome, "Sorry, I had trouble understanding that just now. Please try again in a moment.");
      }
    } else {
      return join(
        welcome,
        "I can only handle quick commands right now (today, week, done, skip, push, help) because no Anthropic API key is configured.",
      );
    }

    // A first "hi" gets the welcome plus the help text.
    if (welcome && intents.length === 1 && intents[0]!.type === "help") {
      return join(welcome, applyIntent(this.db, user, intents[0]!, now).lines[0]);
    }

    const lines: string[] = [];
    let needsReplan = false;
    let show: Range | undefined;
    for (const it of intents) {
      const result = applyIntent(this.db, user, it, now);
      lines.push(...result.lines);
      needsReplan ||= result.replan;
      if (result.show && (!show || result.show === "week")) show = result.show;
    }

    if (needsReplan) {
      const { unplaced } = replan(this.db, user, now);
      for (const u of unplaced) {
        lines.push(
          `⚠️ I couldn't fit ${u.missing} session${u.missing > 1 ? "s" : ""} of *${u.item.title}*. Free up some time, shorten it, or move the deadline.`,
        );
      }
    }

    if (!lines.length && !show && !note) {
      return join(welcome, "I didn't catch anything to plan there. Try something like _gym 3x this week_, or send _help_.");
    }

    return join(welcome, note, lines.join("\n"), show ? formatRange(this.db, user, show, now, this.opts.publicUrl) : null);
  }
}

function join(...parts: (string | null | undefined)[]): string {
  return parts.filter((p): p is string => !!p && p.length > 0).join("\n\n");
}
