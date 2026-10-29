try {
  process.loadEnvFile();
} catch {
  // No .env file; rely on the real environment.
}

function env(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export const config = {
  port: Number(env("PORT", "3000")),
  databasePath: env("DATABASE_PATH", "data/schedule.db"),
  /** Public base URL of this server, used for week-view links (e.g. https://abc.ngrok.app). */
  publicUrl: env("PUBLIC_URL").replace(/\/$/, "") || null,
  defaultTimezone: env("DEFAULT_TIMEZONE", "UTC"),
  /** Digits-only phone numbers allowed to use the bot. Empty means anyone. */
  allowedNumbers: env("ALLOWED_NUMBERS")
    .split(",")
    .map((n) => n.replace(/\D/g, ""))
    .filter(Boolean),
  anthropicModel: env("ANTHROPIC_MODEL", "claude-opus-5-5"),
  whatsapp: {
    token: env("WHATSAPP_TOKEN"),
    phoneNumberId: env("WHATSAPP_PHONE_NUMBER_ID"),
    appSecret: env("WHATSAPP_APP_SECRET"),
    verifyToken: env("WHATSAPP_VERIFY_TOKEN"),
    graphVersion: env("WHATSAPP_GRAPH_VERSION", "v23.0"),
    /** Approved template names used when the 24h service window is closed. */
    summaryTemplate: env("WHATSAPP_SUMMARY_TEMPLATE"),
    reminderTemplate: env("WHATSAPP_REMINDER_TEMPLATE"),
    templateLanguage: env("WHATSAPP_TEMPLATE_LANG", "en"),
  },
};

export type Config = typeof config;
