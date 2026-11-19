import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { migrate } from "./migrate";

export const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "zodiac.db");

export type Db = Database.Database;

export function resolveDbPath(): string {
  return process.env.ZODIAC_DB_PATH?.trim() || DEFAULT_DB_PATH;
}

export function openDatabase(file: string): Db {
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  return db;
}

type DbGlobal = typeof globalThis & { __zodiacDb?: Db };

export function getDb(): Db {
  const g = globalThis as DbGlobal;
  if (!g.__zodiacDb) {
    g.__zodiacDb = openDatabase(resolveDbPath());
    migrate(g.__zodiacDb);
  }
  return g.__zodiacDb;
}
