import { DateTime } from "luxon";
import { Bot } from "../src/bot/bot.js";
import { createDb } from "../src/db/index.js";
import type { ParseContext, ParseResult, Parser } from "../src/nlu/intents.js";

export const ZONE = "Asia/Kolkata";
export const PHONE = "919800000000";
export const at = (iso: string) => DateTime.fromISO(iso, { zone: ZONE }).toUTC();

/** A parser that returns scripted results in order and records what it was asked. */
export class ScriptedParser implements Parser {
  calls: ParseContext[] = [];
  constructor(private results: ParseResult[] = []) {}
  push(...results: ParseResult[]) {
    this.results.push(...results);
  }
  async parse(ctx: ParseContext): Promise<ParseResult> {
    this.calls.push(ctx);
    const next = this.results.shift();
    if (!next) throw new Error("ScriptedParser ran out of results");
    return next;
  }
}

export function setup(results: ParseResult[] = []) {
  const db = createDb(":memory:");
  const parser = new ScriptedParser(results);
  const bot = new Bot(db, parser, { defaultTimezone: ZONE, publicUrl: "https://plan.example" });
  return { db, parser, bot };
}
