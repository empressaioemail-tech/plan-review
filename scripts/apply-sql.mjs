import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const file = process.argv[2];
if (!file) {
  process.stderr.write("usage: node scripts/apply-sql.mjs sql/001_foundation.sql\n");
  process.exit(2);
}
const dsn = readFileSync(join(homedir(), ".empressa", "plan-review.database_url"), "utf8").trim();
if (/fancy-fire|lucky-truth|06136146|tiny-art|snowy-bread/.test(dsn)) {
  throw new Error("refusing cortex-prod, smartcity, or smart-files DSN");
}
const sql = readFileSync(file, "utf8");
const client = new pg.Client({ connectionString: dsn });
await client.connect();
const self = await client.query("select current_database() as db, current_user as usr");
process.stdout.write(`db=${self.rows[0].db} user=${self.rows[0].usr} applying ${file}\n`);
await client.query(sql);
const tables = await client.query(`
  select count(*)::int as n
    from information_schema.tables
   where table_schema = 'public'
     and table_name like 'plan_review_%'
`);
process.stdout.write(`plan_review_* tables=${tables.rows[0].n}\n`);
await client.end();
