import crypto from "node:crypto";
import { and, asc, desc, eq, gt, inArray, lt, ne } from "drizzle-orm";
import { DateTime } from "luxon";
import type { DbLike as Db } from "./db/index.js";
import { blocks, items, messages, users, type Block, type Item, type User } from "./db/schema.js";

export function toIso(dt: DateTime): string {
  return dt.toUTC().toISO()!;
}

export function fromIso(iso: string, zone: string): DateTime {
  return DateTime.fromISO(iso, { zone: "utc" }).setZone(zone);
}

export function getOrCreateUser(
  db: Db,
  phone: string,
  opts: { name?: string | null; timezone: string },
): { user: User; created: boolean } {
  const existing = db.select().from(users).where(eq(users.phone, phone)).get();
  if (existing) {
    if (opts.name && opts.name !== existing.name) {
      db.update(users).set({ name: opts.name }).where(eq(users.id, existing.id)).run();
      existing.name = opts.name;
    }
    return { user: existing, created: false };
  }
  const user = db
    .insert(users)
    .values({
      phone,
      name: opts.name ?? null,
      timezone: opts.timezone,
      webToken: crypto.randomBytes(18).toString("base64url"),
    })
    .returning()
    .get();
  return { user, created: true };
}

export function getUser(db: Db, id: number): User | undefined {
  return db.select().from(users).where(eq(users.id, id)).get();
}

export function updateUser(db: Db, id: number, patch: Partial<User>): User {
  return db.update(users).set(patch).where(eq(users.id, id)).returning().get()!;
}

export function activeItems(db: Db, userId: number): Item[] {
  return db
    .select()
    .from(items)
    .where(and(eq(items.userId, userId), eq(items.status, "active")))
    .orderBy(asc(items.id))
    .all();
}

export function getItem(db: Db, userId: number, id: number): Item | undefined {
  return db
    .select()
    .from(items)
    .where(and(eq(items.userId, userId), eq(items.id, id), ne(items.status, "deleted")))
    .get();
}

export function getBlock(db: Db, userId: number, id: number): Block | undefined {
  return db.select().from(blocks).where(and(eq(blocks.userId, userId), eq(blocks.id, id))).get();
}

export function blocksForItems(db: Db, itemIds: number[]): Block[] {
  if (itemIds.length === 0) return [];
  return db.select().from(blocks).where(inArray(blocks.itemId, itemIds)).all();
}

export interface Entry {
  kind: "event" | "block";
  id: number;
  itemId: number;
  title: string;
  start: DateTime;
  end: DateTime;
  status: Block["status"] | "event";
  pinned: boolean;
}

/** Everything on the user's calendar overlapping [from, to), sorted by start, in local time. */
export function entriesBetween(db: Db, user: User, from: DateTime, to: DateTime): Entry[] {
  const fromStr = toIso(from);
  const toStr = toIso(to);
  const zone = user.timezone;

  const events = db
    .select()
    .from(items)
    .where(
      and(
        eq(items.userId, user.id),
        eq(items.kind, "event"),
        eq(items.status, "active"),
        lt(items.startAt, toStr),
        gt(items.endAt, fromStr),
      ),
    )
    .all();

  const sessionRows = db
    .select({ block: blocks, title: items.title })
    .from(blocks)
    .innerJoin(items, eq(items.id, blocks.itemId))
    .where(
      and(
        eq(blocks.userId, user.id),
        ne(items.status, "deleted"),
        lt(blocks.startAt, toStr),
        gt(blocks.endAt, fromStr),
      ),
    )
    .all();

  const entries: Entry[] = [
    ...events.map((e) => ({
      kind: "event" as const,
      id: e.id,
      itemId: e.id,
      title: e.title,
      start: fromIso(e.startAt!, zone),
      end: fromIso(e.endAt!, zone),
      status: "event" as const,
      pinned: true,
    })),
    ...sessionRows.map(({ block, title }) => ({
      kind: "block" as const,
      id: block.id,
      itemId: block.itemId,
      title,
      start: fromIso(block.startAt, zone),
      end: fromIso(block.endAt, zone),
      status: block.status,
      pinned: block.pinned,
    })),
  ];
  return entries.sort((a, b) => a.start.toMillis() - b.start.toMillis());
}

export function logMessage(
  db: Db,
  userId: number,
  direction: "in" | "out",
  body: string,
  waMessageId?: string,
): void {
  db.insert(messages)
    .values({ userId, direction, body, waMessageId: waMessageId ?? null })
    .run();
}

export function hasSeenMessage(db: Db, waMessageId: string): boolean {
  return !!db.select({ id: messages.id }).from(messages).where(eq(messages.waMessageId, waMessageId)).get();
}

export function recentMessages(db: Db, userId: number, limit: number) {
  return db
    .select()
    .from(messages)
    .where(eq(messages.userId, userId))
    .orderBy(desc(messages.id))
    .limit(limit)
    .all()
    .reverse();
}
