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

**Reviewing applications** (the default view) — every application that's been added, sorted into five tabs by where it is in the workflow:

- **Clean matches** — the automated check found nothing wrong. Still needs an agent's sign-off.
- **Needs attention** — one or more fields didn't match, or couldn't be confirmed from the photos supplied.
- **Approved** / **Rejected** — already signed off, with who decided what and why.
- **Not ready** — still processing, cancelled, or failed. These stay visible on purpose: an application that disappears from every tab never gets adjudicated.

Search by brand or class/type and sort the list, then open an application to review it. The review window puts the label photos and the application fields side by side — each field marked as matching, needing a closer look, disagreeing, or not visible in the photos — and ends in **Approve** or **Reject**. A rejection records why; an approval doesn't need one.

The automated check never decides anything. It sorts the queue and marks the fields worth looking at; a person signs off on every application.

**Add applications** — two ways to get applications into the queue:

- **Single** — fill in the four application fields and attach 1–3 label photos (front, back, or a single composite of both). Processed immediately (it's one item), and the result is saved to the queue right away.
- **Import** — upload a spreadsheet (CSV or XLSX) of application data alongside a batch of label images. Each row's `filenames` column lists that application's photos separated by semicolons (`front.jpg;back.jpg`); the legacy single `filename` column still parses. Rows are queued as `pending` and processed in the background with bounded concurrency, so a 300-row import doesn't fire 300 concurrent Claude calls at once. An in-progress import shows live progress in the queue, with buttons to resume or cancel.

**Photos and what can be checked from them:** one to three per application. One is enough when it's a composite showing front and back together, which is why the minimum isn't two — image *count* never told us what was actually photographed. Instead the extraction call reports whether any image shows a face other than the front, and the warning check branches on it: no warning found with a back view present is a violation; no warning found with no back view present is "not shown", which asks for a better photo instead of reporting a defect. The interviews name that as a real step (*"if an agent can't read the label they just reject it and ask for a better image"*), and conflating it with a violation is what produced the false "missing warning" reports.

**Class/type** is a searchable field backed by TTB's standards of identity ([src/lib/classTypes.ts](src/lib/classTypes.ts)) — a representative subset of 27 CFR Parts 4/5/7, not the exhaustive list, so free text is still accepted rather than blocking an agent on a designation we didn't enumerate.

The Government Warning text is fixed by federal statute (27 CFR 16.21), so it isn't a form field — the app checks the label against the statutory wording directly.

**Quality escalation** — if any field doesn't cleanly match, the app gets a second, independent read from a stronger model (Sonnet) before the result reaches a reviewer, and surfaces whether the two models agree. Only the labels that actually need it pay for the extra call.

**Dark / light mode** — a toggle in the header, defaulting to system preference, persisted per browser.

**Try it** — [public/sample-labels/](public/sample-labels/) has three synthetic products as front/back pairs (the warning appears only on the backs, as it does in reality), and [public/sample-batch-template.csv](public/sample-batch-template.csv) has matching application data — including one deliberate ABV mismatch, to show the escalation flow — for a real import without sourcing your own images.

## Approach & Technical Choices

- **The review queue is the product; single/import are just how applications get into it.** The interviews describe agents pulling up an *existing* application to check, not typing one in from scratch each time — an earlier version of this prototype got that backwards (a stateless form that verified and forgot), which is why persistence and a real queue came in.
- **The automated check produces a triage signal, not a verdict.** Its three values (`clean` / `review` / `discrepancy`) are deliberately different words from an agent's `approved` / `rejected`, because at one point they weren't — the schema used "approved" for both, which would have put two unrelated meanings of the same word in front of an audience the interviews benchmark against someone who *"just learned to video call her grandkids last year."* Every application is signed off by a person; the AI's job is to decide what to look at first, which is the actual complaint in the interviews (*"they're drowning in routine stuff"*).
- **Neon Postgres (via the Vercel Marketplace integration) for application records, Vercel Blob for the label images.** "Vercel Postgres" as a standalone product was retired in favor of Neon; the current recommended driver is `@neondatabase/serverless`, used here via its HTTP query interface (no persistent connection to manage, which matters in a serverless request path — see the earlier Vercel/Fluid-compute discussion about connection pooling). Application rows use plain SQL, no ORM, to keep setup and build time down.
- **Label photos upload from the browser straight to Blob, not through our API.** Vercel Functions cap request bodies at 4.5MB, so routing several multi-megabyte phone photos through an API route would 413 before reaching any of our code — the earlier server-upload flow had this latent bug and only survived testing because the synthetic labels are ~28KB. A token route ([src/app/api/blob/upload-token/route.ts](src/app/api/blob/upload-token/route.ts)) issues short-lived upload tokens and enforces the content-type and size caps at issuance, so the limits don't depend on trusting the client.
- **The warning check distinguishes a bad transcription from a bad label.** An exact-match-or-fail comparison treated a single misread character in ~250 characters of small print as a wording violation, which manufactured false "incorrect warning" reports. It's now tiered: identical → match; ≥97% identical → needs review, described as a likely reading artifact; below that → mismatch. Nothing short of identical is auto-approved, so strictness is preserved — the change is that a measurement error is no longer reported as a label defect.
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
- **The upload-token endpoint is unauthenticated.** Vercel's guidance is to authenticate the user inside `onBeforeGenerateToken`; this prototype has no auth, so anyone who finds that endpoint can write to the Blob store within the type/size caps. That's a storage-abuse and cost vector, not only a data-exposure one — it's the one place where the no-auth posture has a consequence beyond visibility, and it would be the first thing to close in a real deployment.
- **No auth, one shared queue.** Anyone with the URL sees and can add to/delete from the same queue — fine for a single-reviewer prototype demo; a real multi-agent deployment would need accounts and permissions, plus the PII/retention review the IT stakeholder flagged.
- **Deployed on public infrastructure (Vercel) calling a public API (Anthropic).** The stakeholder interview mentioned TTB's real network blocks outbound calls to ML endpoints — a production deployment inside that network would need an on-prem or VPC-hosted model rather than a public API call. Not a concern for this prototype, since it isn't deployed inside TTB's network.
- **Matching thresholds (fuzzy-match similarity, ABV tolerance, net-contents tolerance) are reasonable defaults, not calibrated against real TTB adjudication data.** Each decision now stores which fields the automated check had flagged at the moment of sign-off, so an agent approving something the check flagged is recorded as exactly that — which is the data you'd tune these thresholds against once real reviewers have used it.
- **No component tests.** The comparison, matching, escalation, and spreadsheet logic have unit tests; the React components don't. Adding a browser test harness wasn't a good use of a two-day budget relative to covering the logic that decides outcomes, so the UI was verified by hand against the checklist in the implementation plan.

## Tech Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS v4, Public Sans (USWDS's own typeface), dark/light theming
- Neon Postgres (`@neondatabase/serverless`) for application records; Vercel Blob for label images
- Anthropic Claude — `claude-haiku-4-5` for label extraction, `claude-sonnet-5` for escalated second opinions — via `@anthropic-ai/sdk`
- `exceljs` for spreadsheet import parsing
- Vercel Cron for background-processing reliability
- Vitest for unit tests on the comparison/matching/escalation/spreadsheet logic
- Vercel for deployment
