import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { Bot } from "./bot/bot.js";
import { config } from "./config.js";
import { createDb } from "./db/index.js";
import { Notifier } from "./jobs/notifier.js";
import { ClaudeParser } from "./nlu/claude.js";
import { webRoutes } from "./web/week.js";
import { WhatsAppClient } from "./whatsapp/client.js";
import { whatsappRoutes } from "./whatsapp/webhook.js";

const missing = (
  [
    ["WHATSAPP_TOKEN", config.whatsapp.token],
    ["WHATSAPP_PHONE_NUMBER_ID", config.whatsapp.phoneNumberId],
    ["WHATSAPP_APP_SECRET", config.whatsapp.appSecret],
    ["WHATSAPP_VERIFY_TOKEN", config.whatsapp.verifyToken],
  ] as const
)
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missing.length) {
  console.error(`Missing ${missing.join(", ")}. See SETUP.md, or run \`npm run sim\` to try the bot locally.`);
  process.exit(1);
}

const db = createDb(config.databasePath);
const parser = new ClaudeParser(config.anthropicModel);
const bot = new Bot(db, parser, { defaultTimezone: config.defaultTimezone, publicUrl: config.publicUrl });
const messenger = new WhatsAppClient({
  token: config.whatsapp.token,
  phoneNumberId: config.whatsapp.phoneNumberId,
  graphVersion: config.whatsapp.graphVersion,
  templateLanguage: config.whatsapp.templateLanguage,
});

const app = new Hono();
app.get("/health", (c) => c.json({ ok: true }));
app.route("/", whatsappRoutes({ db, bot, messenger, ...config.whatsapp, allowedNumbers: config.allowedNumbers }).app);
app.route("/", webRoutes(db));

const notifier = new Notifier({
  db,
  messenger,
  publicUrl: config.publicUrl,
  summaryTemplate: config.whatsapp.summaryTemplate,
  reminderTemplate: config.whatsapp.reminderTemplate,
});
notifier.start();

serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`schedule listening on http://localhost:${port} (webhook: /webhook)`);
});
