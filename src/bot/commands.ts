import { intent, type Intent } from "../nlu/intents.js";

/**
 * Single-word commands that don't need the language model. Handling them locally keeps
 * the common replies (done / skip / today) instant and free.
 */
const QUICK: [RegExp, () => Intent][] = [
  [/^(help|menu|\?|hi|hello|hey|start)$/, () => intent("help")],
  [/^(show )?today$/, () => intent("show", { range: "today" })],
  [/^(show )?tomorrow$/, () => intent("show", { range: "tomorrow" })],
  [/^(show )?(my )?(week|plan|schedule)$/, () => intent("show", { range: "week" })],
  [/^(done|did it|finished|✅)$/, () => intent("done")],
  [/^skip$/, () => intent("skip")],
  [/^(push|later|snooze)$/, () => intent("push")],
];

export function quickIntents(text: string): Intent[] | null {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/[.!\s]+$/, "");
  for (const [pattern, make] of QUICK) if (pattern.test(t)) return [make()];
  return null;
}
