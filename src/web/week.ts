import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { DateTime } from "luxon";
import { fmtTime } from "../bot/format.js";
import type { Db } from "../db/index.js";
import { users, type User } from "../db/schema.js";
import { entriesBetween, type Entry } from "../store.js";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

const STYLE = `
:root {
  --bg: #f6f5f1; --card: #ffffff; --ink: #1d1d1b; --muted: #6b6a65; --line: #e4e2db;
  --task: #e7f0ea; --task-ink: #24533a; --event: #e9edf7; --event-ink: #2a3f72;
  --done: #f0efea; --accent: #128c7e;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #141413; --card: #1e1e1c; --ink: #ecebe6; --muted: #9b9a94; --line: #2f2e2b;
    --task: #1f3328; --task-ink: #a8d8bb; --event: #232b40; --event-ink: #b5c4ee;
    --done: #252523; --accent: #3fc1b0;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink);
  font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 1200px; margin: 0 auto; padding: 24px 16px 48px; }
header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 20px; }
h1 { font-size: 22px; margin: 0; letter-spacing: -0.01em; }
.sub { color: var(--muted); font-size: 13px; }
.week { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 900px) { .week { grid-template-columns: 1fr; } }
.day { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px; min-height: 120px; }
.day.today { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }
.day h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; margin: 0 0 10px; color: var(--muted); font-weight: 600; }
.day.today h2 { color: var(--accent); }
.entry { border-radius: 8px; padding: 7px 9px; margin-bottom: 6px; background: var(--task); color: var(--task-ink); }
.entry.event { background: var(--event); color: var(--event-ink); }
.entry.done, .entry.skipped { background: var(--done); color: var(--muted); }
.entry.skipped .title { text-decoration: line-through; }
.time { font-size: 12px; font-variant-numeric: tabular-nums; opacity: 0.85; }
.title { font-weight: 600; overflow-wrap: anywhere; }
.free { color: var(--muted); font-size: 13px; font-style: italic; }
.legend { display: flex; gap: 14px; margin-top: 18px; color: var(--muted); font-size: 12px; flex-wrap: wrap; }
.swatch { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; }
`;

function entryHtml(e: Entry): string {
  const cls = e.kind === "event" ? "event" : e.status;
  const mark = e.status === "done" ? "✓ " : "";
  return `<div class="entry ${cls}"><div class="time">${fmtTime(e.start)}–${fmtTime(e.end)}</div><div class="title">${mark}${esc(e.title)}</div></div>`;
}

export function renderWeek(db: Db, user: User, now: DateTime): string {
  const today = now.setZone(user.timezone).startOf("day");
  const days = Array.from({ length: 7 }, (_, i) => today.plus({ days: i }));
  const entries = entriesBetween(db, user, today, today.plus({ days: 7 }));

  const columns = days
    .map((day) => {
      const mine = entries.filter((e) => e.start.hasSame(day, "day"));
      const label = day.hasSame(today, "day") ? `Today · ${day.toFormat("d LLL")}` : day.toFormat("ccc d LLL");
      return `<section class="day${day.hasSame(today, "day") ? " today" : ""}"><h2>${label}</h2>${
        mine.length ? mine.map(entryHtml).join("") : `<div class="free">Free</div>`
      }</section>`;
    })
    .join("");

  const title = user.name ? `${esc(user.name)}'s week` : "Your week";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <header>
    <h1>${title}</h1>
    <div class="sub">${esc(user.timezone)} · updated ${now.setZone(user.timezone).toFormat("ccc HH:mm")} · change it on WhatsApp</div>
  </header>
  <div class="week">${columns}</div>
  <div class="legend">
    <span><span class="swatch" style="background:var(--task)"></span>Planned</span>
    <span><span class="swatch" style="background:var(--event)"></span>Fixed event</span>
    <span><span class="swatch" style="background:var(--done)"></span>Done / skipped</span>
  </div>
</main>
</body>
</html>`;
}

export function webRoutes(db: Db) {
  const app = new Hono();
  app.get("/w/:token", (c) => {
    const user = db.select().from(users).where(eq(users.webToken, c.req.param("token"))).get();
    if (!user) return c.text("Not found", 404);
    c.header("Cache-Control", "no-store");
    return c.html(renderWeek(db, user, DateTime.utc()));
  });
  return app;
}
