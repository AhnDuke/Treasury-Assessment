// One-time setup script, not part of the request path - run with:
//   npm run db:migrate
// Splits schema.sql on statement boundaries because the Neon HTTP driver
// (appropriate for a serverless request path) executes one statement per
// call, unlike a persistent `pg` connection.
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(here, "..", "db", "schema.sql");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Add it to .env.local (see .env.example) or export it before running this script.");
  process.exit(1);
}

const sql = neon(databaseUrl);
const schema = readFileSync(schemaPath, "utf8");

// Strip `--` comment lines out of each statement rather than dropping whole
// chunks that begin with one - a statement preceded by a comment block (as
// CREATE TABLE is here) would otherwise be discarded silently. Naive about
// `--` inside string literals, which this schema doesn't have.
const statements = schema
  .split(";")
  .map((statement) =>
    statement
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim()
  )
  .filter((statement) => statement.length > 0);

for (const statement of statements) {
  console.log(`Running: ${statement.slice(0, 60)}...`);
  await sql.query(statement);
}

console.log(`Applied ${statements.length} statement(s) from schema.sql.`);
