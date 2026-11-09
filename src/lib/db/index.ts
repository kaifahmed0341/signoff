import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { mkdirSync } from "node:fs";
import path from "node:path";
import * as schema from "./schema";
import { env } from "../env";

export type DB = LibSQLDatabase<typeof schema>;

type Holder = { db?: DB; client?: Client; ready?: Promise<void> };
const g = globalThis as unknown as { __signoffDb?: Holder };
const holder: Holder = (g.__signoffDb ??= {});

const MIGRATIONS = path.join(process.cwd(), "drizzle");

export function createDb(url: string, authToken?: string): { db: DB; client: Client } {
  if (url.startsWith("file:") && !url.includes(":memory:")) {
    const file = url.slice("file:".length);
    mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  const client = createClient({ url, authToken });
  return { db: drizzle(client, { schema }), client };
}

export async function migrateDb(db: DB) {
  await migrate(db, { migrationsFolder: MIGRATIONS });
}

/** Returns the app database, running migrations once per process. */
export async function getDb(): Promise<DB> {
  if (!holder.db) {
    const e = env();
    const { db, client } = createDb(e.DATABASE_URL, e.DATABASE_AUTH_TOKEN);
    holder.db = db;
    holder.client = client;
    holder.ready = migrateDb(db);
  }
  await holder.ready;
  return holder.db;
}

/** Test hook: swap in a fresh database. */
export async function createTestDb(): Promise<DB> {
  const { db, client } = createDb(":memory:");
  await migrateDb(db);
  holder.db = db;
  holder.client = client;
  holder.ready = Promise.resolve();
  return db;
}

export { schema };
