# TTB Label Verification (Prototype)

A review-queue tool for TTB compliance agents: applications go in (one at a time or in bulk), each one is checked automatically against its label photo — brand name, class/type, ABV, net contents, and the federal Government Warning statement — and agents review the queued results. Built for the take-home assessment in [ASSESSMENT.md](ASSESSMENT.md).

## Live Demo

_TODO: add the deployed Vercel URL here._

## Setup & Run

Requires Node 20+, a Neon Postgres database, and a Vercel Blob store.

```bash
npm install
```

Provision the two storage pieces in your Vercel dashboard (**Storage** tab → **Marketplace**): add **Neon** (Postgres) and add **Blob**. Then either run `vercel env pull .env.local` (needs `vercel login` first), or copy `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` from the dashboard into `.env.local` yourself — see [.env.example](.env.example) for the full list, including `ANTHROPIC_KEY` and `CRON_SECRET`.

Apply the schema once:

```bash
npm run db:migrate
```

Then:

```bash
npm run dev   # http://localhost:3000
```

Other scripts: `npm run build` / `npm start` (production build), `npm test` (unit tests), `npm run lint`.

**Background processing** happens inline: uploading kicks off processing immediately, and a normal-sized import finishes in that pass (locally and deployed alike). Two backstops exist for an import too large to finish in one invocation — a **Resume processing** button on the in-progress banner in the queue, and a daily Vercel Cron sweep ([vercel.json](vercel.json) → `/api/cron/process-pending`), which only runs when deployed.

## How It Works

**Review queue** (the default view) — a list of every application that's been added, with its status (pending / processing / done / cancelled / error) and, once done, its overall result (approved / flagged / rejected). Click one to see the full field-by-field breakdown; delete ones you don't need.

**Add applications** — two ways to get applications into the queue:

- **Single** — fill in the four application fields and drop in a label photo. Processed immediately (it's one item), and the result is saved to the queue right away.
- **Import** — upload a spreadsheet (CSV or XLSX) of application data alongside a batch of label images, matched by filename (see the in-app template). Rows are queued as `pending` and processed in the background with bounded concurrency, so a 300-row import doesn't fire 300 concurrent Claude calls at once. An in-progress import shows live progress in the queue, with a button to cancel whatever hasn't started yet.

The Government Warning text is fixed by federal statute (27 CFR 16.21), so it isn't a form field — the app checks the label against the statutory wording directly.

**Quality escalation** — if any field doesn't cleanly match, the app gets a second, independent read from a stronger model (Sonnet) before the result reaches a reviewer, and surfaces whether the two models agree. Only the labels that actually need it pay for the extra call.

**Dark / light mode** — a toggle in the header, defaulting to system preference, persisted per browser.

**Try it** — [public/sample-labels/](public/sample-labels/) has three ready-made synthetic labels, and [public/sample-batch-template.csv](public/sample-batch-template.csv) has matching application data (including one deliberate ABV mismatch, to show the escalation flow) for a real import without sourcing your own images.

## Approach & Technical Choices

- **The review queue is the product; single/import are just how applications get into it.** The interviews describe agents pulling up an *existing* application to check, not typing one in from scratch each time — an earlier version of this prototype got that backwards (a stateless form that verified and forgot), which is why persistence and a real queue came in.
- **Neon Postgres (via the Vercel Marketplace integration) for application records, Vercel Blob for the label images.** "Vercel Postgres" as a standalone product was retired in favor of Neon; the current recommended driver is `@neondatabase/serverless`, used here via its HTTP query interface (no persistent connection to manage, which matters in a serverless request path — see the earlier Vercel/Fluid-compute discussion about connection pooling). Application rows use plain SQL, no ORM, to keep setup and build time down.
- **The Blob store is private, not public.** Label images aren't browser-fetchable by URL; reads go through the SDK authenticated with the store token ([src/lib/blob.ts](src/lib/blob.ts)). This matters because processing is deferred — the invocation running the Claude call is usually not the one that received the upload, so it re-reads the image out of Blob rather than holding bytes in memory. Note this means the app requires a **private** Blob store; a public one will reject the upload.
- **Import processing runs via `after()` right after upload, with two backstops.** A serverless invocation's lifetime is finite even when extended to run work after the response is sent, so a very large import might not finish inline. Anything left `pending` can be picked up by the **Resume processing** button in the queue, or by the cron sweep. Claiming uses `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)`, the standard atomic-claim pattern, so no two of those paths can ever double-process the same row.
- **The cron sweep runs daily, not per-minute, because Vercel's Hobby plan caps cron frequency at once per day.** That makes it a genuine long-tail backstop rather than a near-real-time one, which is why the manual Resume button exists — otherwise a stranded import would wait up to 24 hours. On a Pro plan, changing the schedule in [vercel.json](vercel.json) back to `* * * * *` restores near-real-time recovery and makes the button redundant.
- **Cancel stops future processing, not in-flight processing.** Cancelling a batch marks its remaining `pending` rows `cancelled`; anything already mid-extraction (a couple of seconds, low cost) finishes normally rather than being forcibly aborted.
- **`exceljs`, not `xlsx`/SheetJS, for spreadsheet parsing.** The npm-published `xlsx` package carries two unfixed advisories (prototype pollution, ReDoS) with no patched version on the registry — a real concern for an endpoint that parses user-uploaded files. `exceljs`'s only flagged transitive dependency (`uuid`, moderate severity) is used solely in its XLSX *write* path, which this app never calls (it only reads uploads).
- **Fuzzy matching on brand name and class/type, exact matching on the warning statement.** These two fields needed opposite treatment: the interviews gave a concrete example of a brand name that should *not* be flagged as different ("STONE'S THROW" vs "Stone's Throw" — same brand, different casing), while the warning statement was called out as needing to be exact, word-for-word, down to whether the header is capitalized. So brand/class-type use a normalized similarity score (case/punctuation-insensitive; near-misses land in "needs review" rather than a hard fail), while the warning statement is compared verbatim against the statutory text.
- **ABV and net contents get numeric comparison, not string comparison.** ABV is parsed to a number and compared with a small tolerance; net contents is parsed to a common unit (mL) so "750 mL" and "0.75 L" are recognized as equal.
- **Escalation triggers off our own deterministic match/review/mismatch status, not a self-reported LLM confidence score.** An earlier idea was to have the model grade its own certainty (0–10) per field; that number isn't a calibrated signal (LLMs are known to be poorly calibrated at self-assessed confidence), so instead the second-opinion call fires only on fields the comparison logic already flagged, and it never silently overrides the first read — a disagreement between models is shown to the reviewer, not resolved automatically.
- **The `/api/cron/process-pending` endpoint requires a shared secret**, unlike the rest of this no-auth prototype — it calls the paid Anthropic API on every hit, so it's gated by `CRON_SECRET` (fails closed if unset) even though nothing else here requires a login.

## Assumptions & Trade-offs

- **Bold-formatting on "GOVERNMENT WARNING:" is not verified** — only that it's present and in all caps. Bold is a font-weight property that isn't reliably recoverable from OCR/vision text output; faking a confidence signal here seemed worse than being explicit that it's unverified and should be confirmed visually.
- **No COLA integration.** Per the IT stakeholder, this is a standalone proof-of-concept; COLA integration was explicitly described as a separate, much larger effort.
- **Low-quality images (angles, glare, poor lighting) aren't specially handled.** The stakeholder who raised this flagged it herself as possibly out of scope for a prototype; a bad photo will just produce lower-quality extraction or nulls, surfaced as "not found" rather than a crash.
- **Imports are capped at 300 rows** (matching the "200, 300 label applications" figure from the interviews) — generous for the described scenario, but still a bound on an endpoint with no auth in front of it.
- **No true XLSX cell-embedded images** — import expects a spreadsheet of data plus a separate batch of image files matched by filename, not images embedded inside spreadsheet cells. Extracting those is a meaningfully bigger, more fragile undertaking for the same practical outcome.
- **No auth, one shared queue.** Anyone with the URL sees and can add to/delete from the same queue — fine for a single-reviewer prototype demo; a real multi-agent deployment would need accounts and permissions, plus the PII/retention review the IT stakeholder flagged.
- **Deployed on public infrastructure (Vercel) calling a public API (Anthropic).** The stakeholder interview mentioned TTB's real network blocks outbound calls to ML endpoints — a production deployment inside that network would need an on-prem or VPC-hosted model rather than a public API call. Not a concern for this prototype, since it isn't deployed inside TTB's network.
- **Matching thresholds (fuzzy-match similarity, ABV tolerance, net-contents tolerance) are reasonable defaults, not calibrated against real TTB adjudication data.**

## Tech Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS v4, Public Sans (USWDS's own typeface), dark/light theming
- Neon Postgres (`@neondatabase/serverless`) for application records; Vercel Blob for label images
- Anthropic Claude — `claude-haiku-4-5` for label extraction, `claude-sonnet-5` for escalated second opinions — via `@anthropic-ai/sdk`
- `exceljs` for spreadsheet import parsing
- Vercel Cron for background-processing reliability
- Vitest for unit tests on the comparison/matching/escalation/spreadsheet logic
- Vercel for deployment
