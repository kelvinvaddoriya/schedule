import { describe, expect, it } from "vitest";
import { Notifier } from "../src/jobs/notifier.js";
import { intent } from "../src/nlu/intents.js";
import type { Messenger } from "../src/whatsapp/client.js";
import { at, PHONE, setup } from "./helpers.js";

class RecordingMessenger implements Messenger {
  texts: string[] = [];
  templates: { name: string; params: string[] }[] = [];
  async sendText(_to: string, body: string) {
    this.texts.push(body);
  }
  async sendTemplate(_to: string, name: string, params: string[]) {
    this.templates.push({ name, params });
  }
}

async function plannedUser(summaryTemplate = "", reminderTemplate = "") {
  const { db, bot } = setup([
    {
      intents: [
        intent("add_event", { title: "Dentist", start: "2026-11-02T16:00", end: "2026-11-02T17:00" }),
        intent("add_task", { title: "Read", duration_minutes: 30, sessions: 1, window: "morning" }),
      ],
      reply: null,
    },
  ]);
  // The user messages on Sunday evening, so Monday morning is inside the 24h window.
  await bot.handle({ phone: PHONE, text: "dentist tomorrow 4pm, read a bit", now: at("2026-11-01T20:00") });
  const messenger = new RecordingMessenger();
  const notifier = new Notifier({ db, messenger, publicUrl: null, summaryTemplate, reminderTemplate });
  return { db, bot, messenger, notifier };
}

describe("Notifier", () => {
  it("sends the morning summary once, at the user's time", async () => {
    const { notifier, messenger } = await plannedUser();
    await notifier.tick(at("2026-11-02T07:15"));
    expect(messenger.texts).toEqual([]);

    await notifier.tick(at("2026-11-02T07:30"));
    await notifier.tick(at("2026-11-02T07:31"));
    expect(messenger.texts).toHaveLength(1);
    expect(messenger.texts[0]).toContain("Good morning");
    expect(messenger.texts[0]).toContain("Dentist");
    expect(messenger.texts[0]).toContain("Read");
  });

  it("uses the template once the 24h window has closed", async () => {
    const { notifier, messenger } = await plannedUser("daily_plan");
    await notifier.tick(at("2026-11-03T07:30"));
    expect(messenger.texts).toEqual([]);
    expect(messenger.templates).toHaveLength(1);
    expect(messenger.templates[0]!.name).toBe("daily_plan");
  });

  it("stays quiet outside the window when no template is configured", async () => {
    const { notifier, messenger } = await plannedUser();
    await notifier.tick(at("2026-11-03T07:30"));
    expect(messenger.texts).toEqual([]);
    expect(messenger.templates).toEqual([]);
  });

  it("reminds shortly before events and sessions, once", async () => {
    const { notifier, messenger } = await plannedUser();
    await notifier.tick(at("2026-11-02T07:30")); // summary
    await notifier.tick(at("2026-11-02T07:55"));
    await notifier.tick(at("2026-11-02T07:56"));
    expect(messenger.texts.at(-1)).toBe("⏰ *Read* at 08:00. Reply _done_, _skip_ or _push_.");

    await notifier.tick(at("2026-11-02T15:52"));
    await notifier.tick(at("2026-11-02T15:53"));
    expect(messenger.texts.at(-1)).toBe("⏰ *Dentist* at 16:00.");
    expect(messenger.texts).toHaveLength(3);
  });
});
