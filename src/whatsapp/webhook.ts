import crypto from "node:crypto";
import { Hono } from "hono";
import type { Bot } from "../bot/bot.js";
import type { Db } from "../db/index.js";
import { hasSeenMessage } from "../store.js";
import type { Messenger } from "./client.js";

export interface WebhookOptions {
  db: Db;
  bot: Bot;
  messenger: Messenger;
  verifyToken: string;
  appSecret: string;
  /** Digits-only numbers allowed to use the bot; empty allows everyone. */
  allowedNumbers: string[];
}

/** The subset of the Cloud API webhook payload this app reads. */
interface WebhookPayload {
  object?: string;
  entry?: {
    changes?: {
      value?: {
        contacts?: { wa_id: string; profile?: { name?: string } }[];
        messages?: InboundMessage[];
      };
    }[];
  }[];
}

interface InboundMessage {
  id: string;
  from: string;
  type: string;
  text?: { body: string };
  button?: { text: string };
  interactive?: { button_reply?: { title: string }; list_reply?: { title: string } };
}

export function verifySignature(rawBody: string, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const given = Buffer.from(header.slice("sha256=".length), "hex");
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function messageText(m: InboundMessage): string | null {
  return m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null;
}

export function whatsappRoutes(opts: WebhookOptions) {
  const app = new Hono();
  // Messages from one person are handled strictly in order.
  const queues = new Map<string, Promise<void>>();

  const enqueue = (phone: string, job: () => Promise<void>) => {
    const next = (queues.get(phone) ?? Promise.resolve()).then(job).catch((err) => {
      console.error(`failed handling message from ${phone}:`, err);
    });
    queues.set(phone, next);
    void next.finally(() => {
      if (queues.get(phone) === next) queues.delete(phone);
    });
    return next;
  };

  const handle = async (m: InboundMessage, name: string | undefined) => {
    if (hasSeenMessage(opts.db, m.id)) return; // Meta retries deliveries it thinks failed.
    const text = messageText(m);
    if (text === null) {
      await opts.messenger.sendText(m.from, "Sorry, I can only read text messages for now.");
      return;
    }
    const reply = await opts.bot.handle({ phone: m.from, text, name, waMessageId: m.id });
    await opts.messenger.sendText(m.from, reply);
  };

  // Meta calls this once when you register the webhook URL.
  app.get("/webhook", (c) => {
    const mode = c.req.query("hub.mode");
    const token = c.req.query("hub.verify_token");
    const challenge = c.req.query("hub.challenge");
    if (mode === "subscribe" && opts.verifyToken && token === opts.verifyToken && challenge) {
      return c.text(challenge);
    }
    return c.text("Forbidden", 403);
  });

  app.post("/webhook", async (c) => {
    const raw = await c.req.text();
    if (!opts.appSecret || !verifySignature(raw, c.req.header("x-hub-signature-256"), opts.appSecret)) {
      return c.text("Invalid signature", 401);
    }

    let payload: WebhookPayload;
    try {
      payload = JSON.parse(raw) as WebhookPayload;
    } catch {
      return c.text("Bad JSON", 400);
    }

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        for (const m of value?.messages ?? []) {
          if (opts.allowedNumbers.length && !opts.allowedNumbers.includes(m.from)) continue;
          const name = value?.contacts?.find((ct) => ct.wa_id === m.from)?.profile?.name;
          void enqueue(m.from, () => handle(m, name));
        }
      }
    }

    // Acknowledge straight away and reply asynchronously; Meta retries slow webhooks.
    return c.text("OK");
  });

  /** Resolves once every queued message has been handled. */
  const idle = async () => {
    while (queues.size) await Promise.all(queues.values());
  };

  return { app, idle };
}
