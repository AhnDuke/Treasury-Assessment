// Measures how long the automated check actually takes, against the 5 second
// bar the stakeholder interviews set.
//
//   npm run bench:verify            # 12 applications, kept in the queue
//   npm run bench:verify -- 20      # a different sample size
//   npm run bench:verify -- 12 --cleanup   # delete them again afterwards
//
// Needs a dev server on :3000 and a populated .env.local. This spends real
// Anthropic credit: one Haiku call per application, plus a Sonnet call for any
// application with a field that didn't cleanly match.
//
// It submits through the same route the single-add form uses, so what it times
// is the path a person actually waits on, rather than a synthetic harness. Two
// numbers come back per application:
//
//   server   what the app recorded as processing_ms: fetching the photos back
//            out of Blob, the model calls, and the comparison
//   total    the whole request as the caller saw it, which additionally
//            includes the row insert and the response
//
// The upload of the image bytes to Blob happens before that and is timed
// separately, because in the real app it happens in the browser and is not
// part of what the server is asked to do.

import { put } from "@vercel/blob";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..");
const BASE = process.env.BENCH_BASE_URL ?? "http://localhost:3000";
const TARGET_MS = 5000;

const args = process.argv.slice(2);
const cleanup = args.includes("--cleanup");
const sampleSize = Number(args.find((a) => /^\d+$/.test(a)) ?? 12);

// Pulled from the generated fixture so the sample spans real outcomes: clean
// matches, near misses, hard discrepancies and warning defects. A benchmark
// made only of clean matches would miss the escalation path, which is the
// slow one, and would report a time the app does not actually deliver.
const rows = (await readFile(path.join(repoRoot, "test-batch/applications.csv"), "utf8"))
  .trim()
  .split("\n")
  .slice(1)
  .map((line) => {
    const [filenames, brand_name, class_type, abv_percent, net_contents] = line.split(",");
    return { filenames: filenames.split(";"), brand_name, class_type, abv_percent, net_contents };
  });

if (rows.length === 0) {
  console.error("No fixture rows. Run `npm run gen:fixture` first.");
  process.exit(1);
}

// Evenly spaced through the fixture rather than the first N, which would be
// all clean matches and would flatter the result.
const step = Math.max(1, Math.floor(rows.length / sampleSize));
const sample = [];
for (let i = 0; i < rows.length && sample.length < sampleSize; i += step) sample.push(rows[i]);

const CONTENT_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

function pct(sorted, fraction) {
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
}

function report(label, values) {
  const s = [...values].sort((a, b) => a - b);
  const within = s.filter((v) => v <= TARGET_MS).length;
  const fmt = (v) => `${(v / 1000).toFixed(2)}s`;
  console.log(
    `${label.padEnd(22)} min ${fmt(s[0])}  median ${fmt(pct(s, 0.5))}  p95 ${fmt(pct(s, 0.95))}  max ${fmt(s[s.length - 1])}   within ${TARGET_MS / 1000}s: ${within}/${s.length}`
  );
}

console.log(`Benchmarking ${sample.length} applications against ${BASE}`);
console.log(`Target: results in ${TARGET_MS / 1000}s\n`);

const results = [];
const created = [];

for (const [i, row] of sample.entries()) {
  const label = `${i + 1}/${sample.length} ${row.brand_name}`.padEnd(34);
  try {
    const uploadStart = Date.now();
    const images = [];
    for (const filename of row.filenames) {
      const bytes = await readFile(path.join(repoRoot, "test-batch/images", filename));
      const ext = filename.split(".").pop().toLowerCase();
      const contentType = CONTENT_TYPES[ext] ?? "image/png";
      const blob = await put(`labels/bench-${randomUUID()}-${filename}`, bytes, { access: "private", contentType });
      images.push({ url: blob.url, filename, contentType });
    }
    const uploadMs = Date.now() - uploadStart;

    const requestStart = Date.now();
    const response = await fetch(`${BASE}/api/applications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brandName: row.brand_name,
        classType: row.class_type,
        abvPercent: row.abv_percent,
        netContents: row.net_contents,
        images,
      }),
    });
    const totalMs = Date.now() - requestStart;
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);

    const app = data.application;
    created.push(app.id);
    const serverMs = app.processingMs ?? null;
    results.push({ brand: row.brand_name, images: images.length, uploadMs, serverMs, totalMs, triage: app.triageStatus, status: app.status });

    const flag = serverMs !== null && serverMs > TARGET_MS ? "  OVER" : "";
    console.log(
      `${label} upload ${(uploadMs / 1000).toFixed(2)}s  server ${serverMs === null ? "  n/a" : (serverMs / 1000).toFixed(2) + "s"}  total ${(totalMs / 1000).toFixed(2)}s  ${app.triageStatus ?? app.status}${flag}`
    );
  } catch (err) {
    console.log(`${label} FAILED: ${err.message}`);
  }
}

const ok = results.filter((r) => typeof r.serverMs === "number");
if (ok.length === 0) {
  console.error("\nNo successful runs to summarise.");
  process.exit(1);
}

console.log("\n--- Summary ---");
report("server check", ok.map((r) => r.serverMs));
report("full request", ok.map((r) => r.totalMs));
report("blob upload", ok.map((r) => r.uploadMs));

// Split by whether escalation would have fired, because that is the single
// biggest driver of how long a check takes: a clean read is one model call, a
// flagged one is two, the second to a slower model.
const clean = ok.filter((r) => r.triage === "clean");
const flagged = ok.filter((r) => r.triage && r.triage !== "clean");
console.log("");
if (clean.length) report("  clean (1 call)", clean.map((r) => r.serverMs));
if (flagged.length) report("  flagged (2 calls)", flagged.map((r) => r.serverMs));

const over = ok.filter((r) => r.serverMs > TARGET_MS);
console.log(
  `\n${ok.length - over.length}/${ok.length} within the ${TARGET_MS / 1000}s target` +
    (over.length ? `. Over: ${over.map((r) => `${r.brand} ${(r.serverMs / 1000).toFixed(1)}s`).join(", ")}` : ".")
);

if (cleanup) {
  console.log(`\nCleaning up ${created.length} benchmark applications...`);
  for (const id of created) {
    await fetch(`${BASE}/api/applications/${id}`, { method: "DELETE" }).catch(() => {});
  }
  console.log("Done.");
} else {
  console.log(`\n${created.length} benchmark applications left in the queue. Re-run with --cleanup to remove them.`);
}
