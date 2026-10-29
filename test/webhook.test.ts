import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { intent } from "../src/nlu/intents.js";
import type { Messenger } from "../src/whatsapp/client.js";
import { templateSafe } from "../src/whatsapp/client.js";
import { whatsappRoutes } from "../src/whatsapp/webhook.js";
import { PHONE, setup } from "./helpers.js";

const SECRET = "app-secret";

class FakeMessenger implements Messenger {
  sent: { to: string; body: string }[] = [];
  async sendText(to: string, body: string) {
    this.sent.push({ to, body });
  }
  async sendTemplate() {}
}

function textMessage(id: string, body: string, from = PHONE) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              contacts: [{ wa_id: from, profile: { name: "Asha" } }],
              messages: [{ id, from, timestamp: "1762060000", type: "text", text: { body } }],
            },
          },
        ],
      },
    ],
  };
}

function build(allowedNumbers: string[] = []) {
  const { db, bot, parser } = setup();
  const messenger = new FakeMessenger();
  const routes = whatsappRoutes({ db, bot, messenger, verifyToken: "verify-me", appSecret: SECRET, allowedNumbers });
  const post = (payload: unknown, secret = SECRET) => {
    const body = JSON.stringify(payload);
    const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");
    return routes.app.request("/webhook", {
      method: "POST",
      body,
      headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${sig}` },
    });
  };
  return { ...routes, messenger, parser, post };
}

describe("webhook", () => {
  it("answers Meta's verification handshake", async () => {
    const { app } = build();
    const ok = await app.request("/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345");
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("12345");
    const bad = await app.request("/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=12345");
    expect(bad.status).toBe(403);
  });

  it("rejects payloads without a valid signature", async () => {
    const { post, messenger, idle } = build();
    const res = await post(textMessage("wamid.1", "help"), "wrong-secret");
    expect(res.status).toBe(401);
    await idle();
    expect(messenger.sent).toEqual([]);
  });

  it("replies to text messages", async () => {
    const { post, messenger, idle, parser } = build();
    parser.push({ intents: [intent("add_task", { title: "Gym", duration_minutes: 60, sessions: 3 })], reply: null });
    const res = await post(textMessage("wamid.1", "gym 3x this week"));
    expect(res.status).toBe(200);
    await idle();
    expect(messenger.sent).toHaveLength(1);
    expect(messenger.sent[0]!.to).toBe(PHONE);
    expect(messenger.sent[0]!.body).toContain("Hi Asha");
    expect(messenger.sent[0]!.body).toContain("Added *Gym*");
  });

  it("ignores redelivered messages", async () => {
    const { post, messenger, idle } = build();
    await post(textMessage("wamid.dup", "help"));
    await post(textMessage("wamid.dup", "help"));
    await idle();
    expect(messenger.sent).toHaveLength(1);
  });

  it("ignores numbers that aren't allowed", async () => {
    const { post, messenger, idle } = build(["447700900000"]);
    await post(textMessage("wamid.1", "help"));
    await idle();
    expect(messenger.sent).toEqual([]);
  });

  it("explains that only text is supported", async () => {
    const { post, messenger, idle } = build();
    const payload = textMessage("wamid.img", "");
    const msg = payload.entry[0]!.changes[0]!.value.messages[0]! as Record<string, unknown>;
    msg.type = "image";
    delete msg.text;
    await post(payload);
    await idle();
    expect(messenger.sent[0]!.body).toContain("only read text");
  });
});

describe("templateSafe", () => {
  it("flattens text for template parameters", () => {
    expect(templateSafe("*Today*\n▫️ 09:00 Gym\n\n▫️ 10:00     Read")).toBe("*Today* · ▫️ 09:00 Gym · ▫️ 10:00   Read");
  });
});
