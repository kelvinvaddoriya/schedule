# schedule

A weekly planner you talk to on WhatsApp. Tell it what's on your plate in plain words and it fits everything into a realistic week, then keeps the plan up to date as things change.

```
You:  gym 3x a week evenings, deep work weekday mornings 3h,
      dentist Thu 4pm, finish the report by Friday (~4h)

Bot:  📝 Added Gym — 60 min, 3× a week, evenings
      📝 Added Deep work — 180 min, 5× a week, mornings, weekdays
      📅 Added Dentist — Thu 5 Nov, 16:00–17:00
      📝 Added Report — 120 min, 2 sessions, due Fri 6 Nov 17:00

      Today · Mon 2 Nov
      ▫️ 08:00–11:00 Deep work
      Tomorrow · Tue 3 Nov
      ▫️ 08:00–11:00 Deep work
      ▫️ 11:15–13:15 Report
      ▫️ 17:00–18:00 Gym
      …
      🗓️ Full view: https://…/w/…

(next morning, 07:30)
Bot:  ☀️ Good morning! Here's your day: …

You:  done          You:  push          You:  move gym to 7am
```

## What it does

- **Plans from plain language.** Claude turns messages into structured changes: fixed **events** (appointments, meetings) and flexible **tasks** (habits, routines, one-off work with deadlines).
- **Builds the week itself.** A deterministic planner places task sessions into free time. It respects your preferred time of day and days, spreads repeated sessions across the week, leaves 15-minute buffers, and meets deadlines. It tells you when something doesn't fit.
- **Replans as you go.** Use _done_, _skip_, _push_ (next free slot) or _move X to Y_. Sessions you move by hand stay put; the rest of the plan rearranges around them.
- **Nudges you.** You get a morning summary at a time you choose, plus a reminder 10 minutes before each session or event.
- **Week view.** Each user gets a private, read-only web page with their week.

Quick commands (_today_, _tomorrow_, _week_, _done_, _skip_, _push_, _help_) are handled locally, so they're instant and don't call the API.

## How it works

```
WhatsApp ─► Meta Cloud API ─► POST /webhook (signature-checked, de-duplicated, per-user queue)
                                   │
                         Bot ── quick command? ──► actions
                                   │ no
                         Claude (structured output) ──► intents ──► actions
                                   │
                         replan: planner fills free time around events & pinned sessions
                                   │
                         reply ─► WhatsApp            SQLite ◄─ week view /w/:token
Notifier (every minute): morning summary + reminders, using templates outside the 24h window
```

| Path | What's there |
| --- | --- |
| `src/scheduler/planner.ts` | Pure placement algorithm (no I/O) |
| `src/scheduler/replan.ts` | Rebuilds a user's plan from the database; _push_ |
| `src/nlu/` | Intent schema and the Claude parser |
| `src/bot/` | Conversation handling, actions, WhatsApp-style formatting |
| `src/whatsapp/` | Cloud API client and webhook routes |
| `src/jobs/notifier.ts` | Morning summaries and reminders |
| `src/web/week.ts` | Read-only week page |
| `src/simulator.ts` | Chat with the bot in your terminal |

## Try it locally (no WhatsApp needed)

Requires Node 22+.

```bash
npm install
cp .env.example .env        # add ANTHROPIC_API_KEY (quick commands work without it)
npm run sim
```

The simulator also serves the week page at `http://localhost:3001`. It has two extra commands: `/time 2026-11-02T07:30` (or `/time +2h`) to move the clock, and `/tick` to run the reminder job. Together they let you check morning summaries and reminders.

## Connect WhatsApp

See **[SETUP.md](SETUP.md)** for step-by-step instructions: Meta app, test number, webhook, templates and deployment.

```bash
npm run dev                 # or: npm run build && npm start
```

## Development

```bash
npm test                    # vitest
npm run typecheck
npm run db:generate         # after changing src/db/schema.ts
```

## Roadmap ideas

- Recurring fixed events ("yoga every Tue 6pm")
- Google Calendar sync for fixed events
- Voice notes → text
- Interactive WhatsApp buttons for done / skip / push
- Weekly review on Sundays
