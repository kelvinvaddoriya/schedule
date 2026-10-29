import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ParseResult, type ParseContext, type Parser } from "./intents.js";

const SYSTEM_PROMPT = `You turn WhatsApp messages into actions for a personal weekly planner.

The planner has two kinds of items:
- Events have a fixed time (appointments, meetings, classes). Use add_event with start and end. If no end is given, pick a typical length (appointments 1h, meetings 30–60 min).
- Tasks are flexible; the planner finds time for them. Use add_task with duration_minutes and sessions. Set recurring_weekly to true for habits and routines ("3x a week", "every morning", "daily"); for one-off work ("finish the report by Friday", "gym 3x this week") set it to false and give a deadline when there is one ("this week" means the end of Sunday). Split work longer than about 2 hours into several sessions. Use window and days for preferences like "mornings" or "weekdays". When a duration isn't given, estimate a sensible one.

To change things that already exist, use the ids shown in the context:
- update_item changes an item's title, duration, sessions, window, days, deadline, or an event's start/end. Only fill the fields that change.
- delete_item removes an item and its sessions.
- move puts one session (block_id) or event (item_id) at a new start time. Keep the date the same unless the user names another day.
- push moves a session to the next free slot.
- done / skip mark a session as completed or skipped. If the user doesn't say which, leave the ids null and the planner uses the current or most recent session.
- show displays today, tomorrow or the week.
- set_preferences changes timezone, the hours of the day that can be scheduled (day_start/day_end), the morning summary time ("off" to disable) or reminders.
- help explains what the bot can do.

One message can contain several intents; return all of them in order. Resolve relative dates ("Thursday", "tomorrow", "next week") against the current date in the context, and write every date-time in the user's local timezone.

Only set reply when you need to ask a question (for example when the message is ambiguous and you can't make a reasonable guess) or when the message isn't about planning; otherwise leave it null and the planner will confirm what changed. Keep any reply short and friendly; it is sent as a WhatsApp message.`;

export class ClaudeParser implements Parser {
  private client: Anthropic;

  constructor(
    private model: string,
    client?: Anthropic,
  ) {
    this.client = client ?? new Anthropic();
  }

  async parse(ctx: ParseContext): Promise<ParseResult> {
    const history = ctx.history.map((h) => `${h.role}: ${h.text}`).join("\n") || "(none)";
    const content = `${ctx.state}\n\nRecent conversation:\n${history}\n\nNew message from the user:\n${ctx.message}`;

    const response = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(ParseResult) },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    });

    if (response.stop_reason === "refusal") {
      return { intents: [], reply: "Sorry, I can't help with that one." };
    }
    if (!response.parsed_output) {
      throw new Error(`Claude returned no parseable output (stop_reason: ${response.stop_reason})`);
    }
    return response.parsed_output;
  }
}
