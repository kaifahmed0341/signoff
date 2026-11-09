/**
 * Applies the migrations in drizzle/ to the database in DATABASE_URL
 * (with DATABASE_AUTH_TOKEN for a hosted libSQL database such as Turso).
 * The app also migrates on first use; run this before sending traffic to a new deploy.
 *
 *   DATABASE_URL=libsql://... DATABASE_AUTH_TOKEN=... pnpm db:migrate
 */
import { createDb, migrateDb } from "../src/lib/db/index";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL");
  process.exit(1);
}
const { db, client } = createDb(url, process.env.DATABASE_AUTH_TOKEN);
await migrateDb(db);
const tables = await client.execute("select name from sqlite_master where type = 'table' order by name");
console.log(`Migrated. ${tables.rows.length} tables: ${tables.rows.map((r) => r.name).join(", ")}`);
client.close();
