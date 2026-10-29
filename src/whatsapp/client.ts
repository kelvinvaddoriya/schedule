/** Anything that can deliver a message to a user: the real WhatsApp API, or the console in the simulator. */
export interface Messenger {
  sendText(to: string, body: string): Promise<void>;
  /** Sends an approved template whose body has one `{{1}}` placeholder per param. */
  sendTemplate(to: string, name: string, params: string[]): Promise<void>;
}

/** WhatsApp text messages are capped at 4096 characters. */
const MAX_TEXT = 4096;

export class WhatsAppClient implements Messenger {
  constructor(
    private opts: { token: string; phoneNumberId: string; graphVersion: string; templateLanguage: string },
  ) {}

  private async post(payload: Record<string, unknown>): Promise<void> {
    const url = `https://graph.facebook.com/${this.opts.graphVersion}/${this.opts.phoneNumberId}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.opts.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
    });
    if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${await res.text()}`);
  }

  async sendText(to: string, body: string): Promise<void> {
    const text = body.length > MAX_TEXT ? `${body.slice(0, MAX_TEXT - 1)}…` : body;
    await this.post({ to, type: "text", text: { body: text, preview_url: false } });
  }

  async sendTemplate(to: string, name: string, params: string[]): Promise<void> {
    await this.post({
      to,
      type: "template",
      template: {
        name,
        language: { code: this.opts.templateLanguage },
        components: params.length
          ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text: templateSafe(text) })) }]
          : [],
      },
    });
  }
}

/** Template parameters can't contain newlines, tabs or runs of more than four spaces. */
export function templateSafe(text: string): string {
  const flat = text
    .replace(/\s*\n+\s*/g, " · ")
    .replace(/\t/g, " ")
    .replace(/ {4,}/g, "   ")
    .trim();
  return flat.length > 1000 ? `${flat.slice(0, 999)}…` : flat;
}
