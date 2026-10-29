import readline from "node:readline";
import { serve } from "@hono/node-server";
import { eq } from "drizzle-orm";
import { DateTime, Duration } from "luxon";
import { Bot } from "./bot/bot.js";
import { config } from "./config.js";
import { createDb } from "./db/index.js";
import { users } from "./db/schema.js";
import { Notifier } from "./jobs/notifier.js";
import { ClaudeParser } from "./nlu/claude.js";
import type { Messenger } from "./whatsapp/client.js";
import { webRoutes } from "./web/week.js";

// A WhatsApp stand-in for local development: you type, the bot answers in the terminal.

const PHONE = process.env.SIM_PHONE ?? "15550000000";
const DB_PATH = process.env.SIM_DATABASE_PATH ?? "data/sim.db";
const PORT = Number(process.env.SIM_PORT ?? 3001);

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
// Render WhatsApp *bold* and _italic_ in the terminal.
const pretty = (s: string) => s.replace(/\*([^*\n]+)\*/g, "\x1b[1m$1\x1b[0m").replace(/(^|\s)_([^_\n]+)_/g, "$1\x1b[3m$2\x1b[0m");

const consoleMessenger: Messenger = {
  async sendText(_to, body) {
    console.log(`\n${green("bot (push) ›")} ${pretty(body)}\n`);
  },
  async sendTemplate(_to, name, params) {
    console.log(`\n${green(`bot (template "${name}") ›`)} ${params.join(" | ")}\n`);
  },
};

const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const db = createDb(DB_PATH);
const publicUrl = `http://localhost:${PORT}`;
const bot = new Bot(db, hasKey ? new ClaudeParser(config.anthropicModel) : null, {
  defaultTimezone: config.defaultTimezone,
  publicUrl,
});
const notifier = new Notifier({ db, messenger: consoleMessenger, publicUrl, summaryTemplate: "", reminderTemplate: "" });
const server = serve({ fetch: webRoutes(db).fetch, port: PORT });

let offset = Duration.fromMillis(0);
const now = () => DateTime.utc().plus(offset);
const zone = () => db.select().from(users).where(eq(users.phone, PHONE)).get()?.timezone ?? config.defaultTimezone;

console.log(`
${green("schedule simulator")} — chatting as +${PHONE}, data in ${DB_PATH}
${hasKey ? "Claude parsing is on." : "No ANTHROPIC_API_KEY set: only quick commands (today, week, done, skip, push, help) work."}
Week view: ${publicUrl}/w/<token> (send "week" to get your link)

Simulator commands:
  /time 2026-11-02T07:30   jump the clock to a local time   /time +2h   move it forward
  /tick                     run the reminder/summary job now
  /quit
`);

async function handleLine(line: string): Promise<boolean> {
  if (line === "/quit" || line === "/exit") return false;

  if (line.startsWith("/time")) {
    const arg = line.slice(5).trim();
    const rel = /^\+(\d+)([mhd])$/.exec(arg);
    if (rel) {
      const unit = { m: "minutes", h: "hours", d: "days" }[rel[2] as "m" | "h" | "d"];
      offset = offset.plus({ [unit]: Number(rel[1]) });
    } else {
      const target = DateTime.fromISO(arg, { zone: zone() });
      if (!target.isValid) {
        console.log("Usage: /time 2026-11-02T07:30 or /time +2h");
        return true;
      }
      offset = Duration.fromMillis(target.toMillis() - DateTime.utc().toMillis());
    }
    console.log(dim(`clock is now ${now().setZone(zone()).toFormat("cccc d LLL yyyy, HH:mm")}`));
    return true;
  }

  if (line === "/tick") {
    await notifier.tick(now());
    console.log(dim("(tick done)"));
    return true;
  }

  try {
    const reply = await bot.handle({ phone: PHONE, text: line, name: process.env.SIM_NAME ?? null, now: now() });
    console.log(`\n${green("bot ›")} ${pretty(reply)}\n`);
  } catch (err) {
    console.error(err);
  }
  return true;
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const prompt = () => {
  rl.setPrompt(dim(`[${now().setZone(zone()).toFormat("ccc d LLL HH:mm")}] you › `));
  rl.prompt();
};
prompt();
for await (const raw of rl) {
  const line = raw.trim();
  if (line && !(await handleLine(line))) break;
  prompt();
}
rl.close();
server.close();
