// Loads the generated fixture into a running instance, optionally clearing
// whatever is already there first.
//
//   npm run seed                 # add the fixture to what already exists
//   npm run seed -- --clear      # DELETE every application and blob first
//   npm run seed -- --clear --limit 10
//
// Needs a dev server on :3000 (or BASE_URL) and a populated .env.local. It
// spends real Anthropic credit: one Haiku call per application, plus a Sonnet
// call for any application with a field that didn't cleanly match.
//
// Applications are created through the same route the guided import uses, and
// left undecided. Sign-offs are not seeded: the premise of the tool is that a
// person makes them, and inventing a few to make a tab look populated would be
// fabricating exactly the record the app exists to keep honest.

import { put, list, del } from "@vercel/blob";
import { neon } from "@neondatabase/serverless";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const args = process.argv.slice(2);
const shouldClear = args.includes("--clear");
const limitArg = args.indexOf("--limit");
const limit = limitArg !== -1 ? Number(args[limitArg + 1]) : Infinity;

const CONTENT_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

async function clearEverything() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  const sql = neon(process.env.DATABASE_URL);

  const [{ n: rows }] = await sql`SELECT count(*)::int AS n FROM applications`;

  // Blobs first. Deleting the rows first would lose the only record of which
  // blobs belong to this app, leaving them to accumulate unreferenced.
  let deletedBlobs = 0;
  let cursor;
  do {
    const page = await list({ cursor, limit: 1000 });
    if (page.blobs.length > 0) {
      await del(page.blobs.map((b) => b.url));
      deletedBlobs += page.blobs.length;
    }
    cursor = page.cursor;
  } while (cursor);

  await sql`DELETE FROM applications`;
  console.log(`Cleared ${rows} application${rows === 1 ? "" : "s"} and ${deletedBlobs} blob${deletedBlobs === 1 ? "" : "s"}.\n`);
}

async function loadFixture() {
  const csv = await readFile(path.join(repoRoot, "test-batch/applications.csv"), "utf8");
  const [header, ...lines] = csv.trim().split("\n");
  const columns = header.split(",");
  return lines.map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(columns.map((c, i) => [c.trim(), (cells[i] ?? "").trim()]));
  });
}

if (shouldClear) {
  if (!args.includes("--yes")) {
    console.log("--clear deletes EVERY application and EVERY blob in the store. This cannot be undone.");
    console.log("Re-run with --yes to confirm:\n  npm run seed -- --clear --yes\n");
    process.exit(1);
  }
  await clearEverything();
}

const rows = (await loadFixture()).slice(0, limit);
if (rows.length === 0) {
  console.error("No fixture rows. Run `npm run gen:fixture` first.");
  process.exit(1);
}

// One batch id for the whole load, so the queue groups them and can report
// progress and cancel the remainder, exactly as a real import would.
const importBatchId = randomUUID();
console.log(`Loading ${rows.length} applications into ${BASE}`);

let created = 0;
const failures = [];

for (const [index, row] of rows.entries()) {
  try {
    const images = [];
    for (const filename of row.filenames.split(";").filter(Boolean)) {
      const bytes = await readFile(path.join(repoRoot, "test-batch/images", filename));
      const ext = filename.split(".").pop().toLowerCase();
      const contentType = CONTENT_TYPES[ext] ?? "image/png";
      const blob = await put(`labels/${randomUUID()}-${filename}`, bytes, { access: "private", contentType });
      images.push({ url: blob.url, filename, contentType });
    }

    const response = await fetch(`${BASE}/api/applications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brandName: row.brand_name,
        classType: row.class_type,
        abvPercent: row.abv_percent,
        netContents: row.net_contents,
        bottlerInfo: row.bottler_info || null,
        countryOfOrigin: row.country_of_origin || null,
        images,
        importBatchId,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
    created += 1;
    process.stdout.write(`\r  queued ${created}/${rows.length}  ${row.brand_name.padEnd(24).slice(0, 24)}`);
  } catch (err) {
    failures.push(`${index + 1} ${row.brand_name}: ${err.message}`);
  }
}
process.stdout.write("\n");

if (failures.length > 0) {
  console.log(`\n${failures.length} row(s) failed:`);
  for (const f of failures) console.log("  " + f);
}
if (created === 0) process.exit(1);

// Nothing was checked while loading, matching how an import behaves: the batch
// starts once, after every row has been handled.
console.log("\nStarting the checks...");
await fetch(`${BASE}/api/applications/process`, { method: "POST" });

const started = Date.now();
let lastPending = -1;
for (;;) {
  await new Promise((r) => setTimeout(r, 4000));
  const data = await (await fetch(`${BASE}/api/applications`)).json();
  const mine = (data.applications ?? []).filter((a) => a.importBatchId === importBatchId);
  const pending = mine.filter((a) => a.status === "pending" || a.status === "processing").length;
  if (pending !== lastPending) {
    process.stdout.write(`\r  ${mine.length - pending}/${mine.length} checked`);
    lastPending = pending;
  }
  if (pending === 0) {
    process.stdout.write("\n");
    const by = mine.reduce((acc, a) => ({ ...acc, [a.triageStatus ?? a.status]: (acc[a.triageStatus ?? a.status] ?? 0) + 1 }), {});
    console.log(`\nDone in ${Math.round((Date.now() - started) / 1000)}s.`);
    console.log("  " + Object.entries(by).map(([k, v]) => `${k}=${v}`).join("  "));
    console.log("\nCompare against test-batch/EXPECTED.md, which lists what each row should produce.");
    break;
  }
  if (Date.now() - started > 15 * 60 * 1000) {
    console.log("\nStill going after 15 minutes. Press Resume processing in the queue to continue.");
    break;
  }
}
