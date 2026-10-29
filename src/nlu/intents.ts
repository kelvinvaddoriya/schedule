import { z } from "zod";

// One flat object per intent keeps the JSON schema simple for structured outputs:
// every field is present, and fields that don't apply to an intent are null.

export const IntentType = z.enum([
  "add_event",
  "add_task",
  "update_item",
  "delete_item",
  "move",
  "push",
  "done",
  "skip",
  "show",
  "set_preferences",
  "help",
]);

const localDateTime = z
  .string()
  .nullable()
  .describe("Local date-time in the user's timezone, formatted YYYY-MM-DDTHH:mm");

export const Intent = z.object({
  type: IntentType,
  title: z.string().nullable().describe("Short title, e.g. 'Gym' or 'Dentist'"),
  start: localDateTime,
  end: localDateTime,
  duration_minutes: z.number().int().nullable().describe("Length of one task session"),
  sessions: z
    .number()
    .int()
    .nullable()
    .describe("Number of sessions: per week if recurring_weekly, otherwise in total"),
  recurring_weekly: z.boolean().nullable(),
  window: z.enum(["morning", "afternoon", "evening", "any"]).nullable(),
  days: z.enum(["any", "weekdays", "weekends"]).nullable(),
  deadline: localDateTime,
  item_id: z.number().int().nullable().describe("Id of an existing item (#n in the context)"),
  block_id: z.number().int().nullable().describe("Id of a scheduled session (bn in the context)"),
  range: z.enum(["today", "tomorrow", "week"]).nullable(),
  timezone: z.string().nullable().describe("IANA timezone, e.g. Asia/Kolkata"),
  day_start: z.string().nullable().describe("HH:mm"),
  day_end: z.string().nullable().describe("HH:mm"),
  summary_time: z.string().nullable().describe("HH:mm, or 'off'"),
  reminders: z.boolean().nullable(),
});

export const ParseResult = z.object({
  intents: z.array(Intent),
  reply: z
    .string()
    .nullable()
    .describe("A short message for the user, only when a question or clarification is needed"),
});

export type Intent = z.infer<typeof Intent>;
export type ParseResult = z.infer<typeof ParseResult>;

/** Builds an intent with every field null except the ones given. */
export function intent(type: Intent["type"], fields: Partial<Omit<Intent, "type">> = {}): Intent {
  return {
    type,
    title: null,
    start: null,
    end: null,
    duration_minutes: null,
    sessions: null,
    recurring_weekly: null,
    window: null,
    days: null,
    deadline: null,
    item_id: null,
    block_id: null,
    range: null,
    timezone: null,
    day_start: null,
    day_end: null,
    summary_time: null,
    reminders: null,
    ...fields,
  };
}

export interface ParseContext {
  /** Human-readable snapshot of the user's settings, items and upcoming sessions. */
  state: string;
  /** Recent turns, oldest first. */
  history: { role: "user" | "bot"; text: string }[];
  message: string;
}

export interface Parser {
  parse(ctx: ParseContext): Promise<ParseResult>;
}
