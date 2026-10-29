# Connecting WhatsApp

This takes about 20 minutes. You'll end up with Meta's free test number talking to the bot running on your machine. After that, you can deploy it and (optionally) switch to a real number.

Meta occasionally renames things in its dashboard. If a label below doesn't match exactly, look for the closest equivalent.

## 1. Create the Meta app

1. Go to [developers.facebook.com](https://developers.facebook.com/), log in, and open **My Apps → Create app**.
2. Pick the **Business** type (or the "Connect with customers through WhatsApp" use case), give it a name, and create it. Meta may ask you to create or pick a Business portfolio.
3. Add the **WhatsApp** product to the app.

## 2. Get the credentials

In **WhatsApp → API Setup**:

- **Temporary access token** → `WHATSAPP_TOKEN`. It expires after about 24 hours, which is fine for testing. Step 7 covers a permanent token.
- **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`. Use the ID of the test number Meta gives you, not the number itself.
- Under **To**, add **your own WhatsApp number** as a recipient and confirm it with the code Meta sends. The test number can only talk to numbers on this list.

In **App settings → Basic**:

- **App secret** → `WHATSAPP_APP_SECRET`. The bot uses it to check that webhook calls really come from Meta.

Pick any random string for `WHATSAPP_VERIFY_TOKEN`, for example from `openssl rand -hex 16`.

You also need an Anthropic API key from [console.anthropic.com](https://console.anthropic.com/) → `ANTHROPIC_API_KEY`.

## 3. Configure and run

```bash
cp .env.example .env    # fill in the values above
npm install
npm run dev             # listens on http://localhost:3000
```

Set `DEFAULT_TIMEZONE` to your timezone (e.g. `Asia/Kolkata`, `Europe/London`). Set `ALLOWED_NUMBERS` to your number (digits only, with country code, e.g. `919812345678`) so nobody else can run up your API bill.

## 4. Expose it to the internet

Meta needs a public HTTPS URL. While developing, use a tunnel:

```bash
npx cloudflared tunnel --url http://localhost:3000
# or: ngrok http 3000
```

Copy the `https://…` URL it prints and put it in `.env` as `PUBLIC_URL` (used for the week-view link). Then restart `npm run dev`.

## 5. Register the webhook

In **WhatsApp → Configuration → Webhook**:

1. **Callback URL**: `https://<your-tunnel>/webhook`
2. **Verify token**: the same value as `WHATSAPP_VERIFY_TOKEN`
3. Click **Verify and save**. The bot answers Meta's check automatically.
4. Under **Webhook fields**, **subscribe to `messages`**.

## 6. Say hi

Send "hi" from your phone to the test number. You should get the welcome message. Then try something like:

> gym 3x this week in the evenings, dentist Thursday 4pm, and I need ~4 hours for the report by Friday

If nothing comes back, check the terminal running `npm run dev`. Common causes:

- `401` on `/webhook`: the app secret doesn't match.
- `WhatsApp API 401`: the access token has expired.
- `(#131030) Recipient phone number not in allowed list`: add your number in API Setup.

## 7. Morning summaries and reminders outside the 24-hour window

WhatsApp only lets a business send free-form messages within **24 hours of the user's last message**. After that, the bot needs pre-approved **templates**. If you chat with the bot daily, you rarely hit this. If you don't set up templates, the bot skips those messages rather than failing.

In **WhatsApp Manager → Message templates**, create two templates in the **Utility** category. Each has one variable per `{{n}}`:

| Env var | Suggested name | Body |
| --- | --- | --- |
| `WHATSAPP_SUMMARY_TEMPLATE` | `daily_plan` | `Good morning! Here's your day: {{1}}` |
| `WHATSAPP_REMINDER_TEMPLATE` | `session_reminder` | `Reminder: {{1}} at {{2}}. Reply done, skip or push.` |

Once Meta approves them (usually within minutes), set the names in `.env` and `WHATSAPP_TEMPLATE_LANG` to the language code you chose (e.g. `en`, `en_US`). Template parameters can't contain line breaks, so the summary is sent as a single line in that case.

**Cost:** replies inside the 24-hour window are free. Template messages are billed per message by Meta, at a rate that depends on the recipient's country. See Meta's WhatsApp pricing page.

## 8. Deploy

Any host that runs Node 22 and keeps a persistent disk for the SQLite file works. Railway, Fly.io and Render are all simple options.

- Build command: `npm install && npm run build`. Start command: `npm start`.
- Mount a volume and set `DATABASE_PATH` to a file on it (e.g. `/data/schedule.db`).
- Set all the `.env` values as environment variables, and set `PUBLIC_URL` to the deployed URL.
- Update the webhook **Callback URL** in Meta to `https://<your-app>/webhook`.

For a token that doesn't expire, create a **System user** in Meta Business Settings. Give it access to the app and the WhatsApp account, then generate a token with the `whatsapp_business_messaging` and `whatsapp_business_management` permissions.

## 9. (Later) Use a real number

The test number is fine for personal use with up to 5 recipients. To message anyone, add a real phone number in **API Setup → Add phone number**. It must **not** already be registered on the WhatsApp or WhatsApp Business app; if it is, delete that account first. Then verify your business in Meta Business Settings.
