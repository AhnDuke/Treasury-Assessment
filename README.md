# TTB Label Verification (Prototype)

A review-queue tool for TTB compliance agents: applications go in (one at a time or in bulk), each one is checked automatically against its label photos - brand name, class/type, ABV, net contents, and the federal Government Warning statement - and a person signs off on every application in the queue. Built for the take-home assessment in [ASSESSMENT.md](ASSESSMENT.md).

## Live Demo

https://treasury-assessment-hazel.vercel.app/

## Setup & Run

Requires Node 20+, a Neon Postgres database, and a Vercel Blob store.

```bash
npm install
```

Provision the two storage pieces in your Vercel dashboard (**Storage** tab → **Marketplace**): add **Neon** (Postgres) and add **Blob**. Then either run `vercel env pull .env.local` (needs `vercel login` first), or copy `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` from the dashboard into `.env.local` yourself - see [.env.example](.env.example) for the full list, including `ANTHROPIC_KEY` and `CRON_SECRET`.

Apply the schema once:

```bash
npm run db:migrate
```

Then:

```bash
npm run dev   # http://localhost:3000
```

Other scripts: `npm run build` / `npm start` (production build), `npm test` (unit tests), `npm run lint`.

**Background processing**: a single add is checked inline and returns its result. An import queues its rows untouched and starts checking only once every row has been submitted or scrapped, so an agent working a long sheet is never competing with a stream of Claude calls. Two backstops exist for a batch too large to finish in one invocation - a **Resume processing** button on the in-progress banner in the queue, and a daily Vercel Cron sweep ([vercel.json](vercel.json) → `/api/cron/process-pending`), which only runs when deployed.

**Staying current**: the queue checks for finished work in the background but never rearranges itself while you are reading. When something changes it offers a **Refresh** button saying how many applications finished or changed, and applies the update when you ask for it. Anything you do yourself, a decision or a delete, takes effect immediately.

## How It Works

**Reviewing applications** (the default view) - every application that's been added, sorted into five tabs by where it is in the workflow:

- **Clean matches** - the automated check found nothing wrong. Still needs an agent's sign-off.
- **Needs attention** - one or more fields didn't match, or couldn't be confirmed from the photos supplied.
- **Approved** / **Rejected** - already signed off, with the reason and the time of the decision.
- **Not ready** - still processing, cancelled, or failed. These stay visible on purpose: an application that disappears from every tab never gets adjudicated.

Search by brand or class/type, and sort by clicking any column header (a second click reverses it). Open an application by clicking its row or the Review button. The review window puts the label photos and the application fields side by side - each field marked as matching, needing a closer look, disagreeing, not found, or not visible in the photos - and ends in **Approve** or **Reject**. A rejection records why; an approval doesn't need one.

The automated check never decides anything. It sorts the queue and marks the fields worth looking at; a person signs off on every application.

**Add applications** - two ways to get applications into the queue:

- **Single** - fill in the four application fields and attach 1–3 label photos (front, back, or a single composite of both). Processed immediately (it's one item), and the result is saved to the queue right away.
- **Import** - upload a spreadsheet (CSV or XLSX) of application data. The sheet is read first and nothing is created from it; the agent then works the rows one at a time from a worklist, checking each row's details, attaching that application's label photos, and either submitting it or scrapping it. Rows can be revisited in any order until they're submitted, and switching to the review queue mid-import doesn't lose the session. Each submit queues the application as `pending` and moves straight on - nothing is checked while the sheet is still being worked - and once the last row is handled the whole batch starts processing at once with bounded concurrency. The queue then shows the batch's progress with buttons to resume or cancel. A `filenames` column, if present, is surfaced as a per-row reminder of which files belong to that row - the app doesn't resolve it, so sheets without one work the same.

**Photos and what can be checked from them:** one to three per application. One is enough when it's a composite showing front and back together, which is why the minimum isn't two - image _count_ never told us what was actually photographed. Instead the extraction call reports whether any image shows a face other than the front, and the warning check branches on it: no warning found with a back view present is a violation; no warning found with no back view present is "not shown", which asks for a better photo instead of reporting a defect. The interviews name that as a real step (_"if an agent can't read the label they just reject it and ask for a better image"_), and conflating it with a violation is what produced the false "missing warning" reports.

**Beverage type and the alcohol content rule.** The mandatory label information differs by product, and alcohol content is where it differs most:

| | Distilled spirits (part 5) | Wine (part 4) | Malt beverages (part 7) |
|---|---|---|---|
| Alcohol content on the label | always required (5.65) | required (4.34), except a 7-14% wine may use the class designation "table wine" or "light wine" instead | **not required** unless the alcohol comes from added nonbeverage flavors (7.63(a)(3)) |

So the app resolves a beverage type for each application and applies the right rule. If the label states no alcohol content, that is a `missing` finding for spirits and a `not_required` note for an ordinary beer, which keeps compliant products out of the Needs attention tab. Checking everything against the distilled-spirits rule reported a violation that does not exist, and flagged every compliant American beer.

The type is normally worked out from the class/type designation ([src/lib/beverageType.ts](src/lib/beverageType.ts)). It can be declared explicitly on the form or in a `beverage_type` column when the designation is free text we would not recognise. An undetermined type is never treated as "required": asserting a violation under a rule we could not identify is the failure this exists to prevent. TTB has a **proposed** rule making alcohol content mandatory for products that currently need not carry it; `abvRequirement` is the single place that would change.

**Class/type** is a searchable field backed by TTB's standards of identity ([src/lib/classTypes.ts](src/lib/classTypes.ts)) - a representative subset of 27 CFR Parts 4/5/7, not the exhaustive list, so free text is still accepted rather than blocking an agent on a designation we didn't enumerate.

The Government Warning text is fixed by federal statute (27 CFR 16.21), so it isn't a form field - the app checks the label against the statutory wording directly.

**Quality escalation** - if any field doesn't cleanly match, the app gets a second, independent read from a stronger model (Sonnet) before the result reaches a reviewer, and surfaces whether the two models agree. Fields nobody photographed (`not_shown`) are excluded from this - a second model re-reading the same images can't find text that isn't in them, so escalating an evidence gap would only cost a Sonnet call for nothing. Only the labels that actually need it pay for the extra call.

**Dark / light mode** - a toggle in the header, defaulting to system preference, persisted per browser.

**Try it** - [public/sample-labels/](public/sample-labels/) has three synthetic products as front/back pairs (the warning appears only on the backs, as it does in reality), and [public/sample-batch-template.csv](public/sample-batch-template.csv) has matching application data - including one deliberate ABV mismatch, to show the escalation flow - for a real import without sourcing your own images.

For something larger, `npm run gen:fixture` writes a 40-application fixture to `test-batch/` with its own labels, covering every outcome the app can produce: clean matches, casing-only brand differences that should _not_ be flagged, near-miss spellings, ABV inside and outside tolerance, equivalent volume units, a title-case warning header, altered warning wording, a back label with no warning at all, and front-only uploads where the warning can't be judged. `test-batch/EXPECTED.md` lists what each row should produce, so a run can be checked against intent rather than against whatever it happened to return.

## Speed

The interviews set a hard number on this. The scanning-vendor pilot died because it "would take 30, 40 seconds sometimes to process a single label", and the stated bar was: _"If we can't get results back in about 5 seconds, nobody's going to use it."_

So every check records how long it took, and the queue shows it per application in a **Checked in** column you can sort by. `npm run bench:verify` re-runs the measurement across real labels and real model calls.

Measured over 14 applications drawn evenly across the fixture, so the sample spans clean reads, near misses and hard discrepancies rather than only the easy ones:

|                                                                   | median | p95  | slowest | within 5s |
| ----------------------------------------------------------------- | ------ | ---- | ------- | --------- |
| **Automated check** (photos out of Blob, model calls, comparison) | 3.3s   | 4.7s | 4.7s    | **14/14** |
| Clean match, one model call                                       | 2.3s   | 3.0s | 3.0s    | 7/7       |
| Flagged, escalated to a second model                              | 3.6s   | 4.7s | 4.7s    | 7/7       |

**The agent almost never waits for any of that.** An imported application is checked before anyone opens it, so reviewing one is a database read: the queue loads in ~80ms and a label photo in ~130ms, about 200ms to have an application open and ready to judge. The measured 5-second path is the single-add form, where someone does wait, and the throughput of a batch.

Two honest notes. The escalation path roughly doubles the time, because a field that doesn't cleanly match earns a second opinion from a slower model; at 4.7s the worst case clears the bar but not by much, and a busier API would eat that margin. And these numbers come from a local dev server against synthetic labels, which are clean, small and evenly lit. A photographed bottle will be larger to upload and harder to read.

## Approach & Technical Choices

- **The review queue is the product; single/import are just how applications get into it.** The interviews describe agents pulling up an _existing_ application to check, not typing one in from scratch each time - an earlier version of this prototype got that backwards (a stateless form that verified and forgot), which is why persistence and a real queue came in.
- **The automated check produces a triage signal, not a verdict.** Its three values (`clean` / `review` / `discrepancy`) are deliberately different words from an agent's `approved` / `rejected`, because at one point they weren't - the schema used "approved" for both, which would have put two unrelated meanings of the same word in front of an audience the interviews benchmark against someone who _"just learned to video call her grandkids last year."_ Every application is signed off by a person; the AI's job is to decide what to look at first, which is the actual complaint in the interviews (_"they're drowning in routine stuff"_).
- **Neon Postgres (via the Vercel Marketplace integration) for application records, Vercel Blob for the label images.** "Vercel Postgres" as a standalone product was retired in favor of Neon; the current recommended driver is `@neondatabase/serverless`, used here via its HTTP query interface (no persistent connection to manage, which matters in a serverless request path - see the earlier Vercel/Fluid-compute discussion about connection pooling). Application rows use plain SQL, no ORM, to keep setup and build time down.
- **Label photos upload from the browser straight to Blob, not through our API.** Vercel Functions cap request bodies at 4.5MB, so routing several multi-megabyte phone photos through an API route would 413 before reaching any of our code - the earlier server-upload flow had this latent bug and only survived testing because the synthetic labels are ~28KB. A token route ([src/app/api/blob/upload-token/route.ts](src/app/api/blob/upload-token/route.ts)) issues short-lived upload tokens and enforces the content-type and size caps at issuance, so the limits don't depend on trusting the client.
- **The warning check distinguishes a bad transcription from a bad label.** An exact-match-or-fail comparison treated a single misread character in ~250 characters of small print as a wording violation, which manufactured false "incorrect warning" reports. It's now tiered: identical → match; ≥97% identical → needs review, described as a likely reading artifact; below that → mismatch. Nothing short of identical is auto-cleared, so strictness is preserved - the change is that a measurement error is no longer reported as a label defect.
- **The Blob store is private, not public.** Label images aren't browser-fetchable by Blob URL; reads go through the SDK authenticated with the store token ([src/lib/blob.ts](src/lib/blob.ts)). This matters because processing is deferred - the invocation running the Claude call is usually not the one that received the upload, so it re-reads the image out of Blob rather than holding bytes in memory. Note this means the app requires a **private** Blob store; a public one will reject the upload. The app itself does serve those same bytes to the browser, through its own route (`GET /api/applications/:id/images/:index`), authenticated to Blob on the server side - but that route has no auth of its own, like the rest of this prototype, so what's private here is the storage, not the images once the app is deployed and reachable.
- **An import checks nothing until the whole sheet is handled.** Submitting each row as it's finished would mean an agent typing into row 12 while a dozen Claude calls compete for the same serverless invocation, and rows flickering between states underneath them. Instead every row is queued untouched and the batch is kicked off once, via `after()`, when the last one is submitted or scrapped. A serverless invocation's lifetime is finite even when extended to run work after the response is sent, so a very large batch might not finish in that pass; anything left `pending` is picked up by the **Resume processing** button in the queue or by the cron sweep. Claiming uses `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)`, the standard atomic-claim pattern, so no two of those paths can ever double-process the same row.
- **Abandoning an import halfway leaves its rows queued, not lost.** They sit `pending` and are visible in the queue's **Not ready** tab; **Resume processing** or the cron sweep will check them. The trade-off is that walking away mid-sheet doesn't automatically start anything - which is the same property that keeps processing out of the agent's way while they work.
- **The cron sweep runs daily, not per-minute, because Vercel's Hobby plan caps cron frequency at once per day.** That makes it a genuine long-tail backstop rather than a near-real-time one, which is why the manual Resume button exists - otherwise a stranded import would wait up to 24 hours. On a Pro plan, changing the schedule in [vercel.json](vercel.json) back to `* * * * *` restores near-real-time recovery and makes the button redundant.
- **Cancel stops future processing, not in-flight processing.** Cancelling a batch marks its remaining `pending` rows `cancelled`; anything already mid-extraction (a couple of seconds, low cost) finishes normally rather than being forcibly aborted.
- **`exceljs`, not `xlsx`/SheetJS, for spreadsheet parsing.** The npm-published `xlsx` package carries two unfixed advisories (prototype pollution, ReDoS) with no patched version on the registry - a real concern for an endpoint that parses user-uploaded files. `exceljs`'s only flagged transitive dependency (`uuid`, moderate severity) is used solely in its XLSX _write_ path, which this app never calls (it only reads uploads).
- **Fuzzy matching on brand name and class/type, exact matching on the warning statement.** These two fields needed opposite treatment: the interviews gave a concrete example of a brand name that should _not_ be flagged as different ("STONE'S THROW" vs "Stone's Throw" - same brand, different casing), while the warning statement was called out as needing to be exact, word-for-word, down to whether the header is capitalized. So brand/class-type use a normalized similarity score (case/punctuation-insensitive; near-misses land in "needs review" rather than a hard fail), while the warning statement is compared verbatim against the statutory text.
- **ABV and net contents get numeric comparison, not string comparison.** ABV is parsed to a number and compared with a small tolerance; net contents is parsed to a common unit (mL) so "750 mL" and "0.75 L" are recognized as equal.
- **Escalation triggers off our own deterministic match/review/mismatch status, not a self-reported LLM confidence score.** An earlier idea was to have the model grade its own certainty (0–10) per field; that number isn't a calibrated signal (LLMs are known to be poorly calibrated at self-assessed confidence), so instead the second-opinion call fires only on fields the comparison logic already flagged, and it never silently overrides the first read - a disagreement between models is shown to the reviewer, not resolved automatically.
- **The `/api/cron/process-pending` endpoint requires a shared secret**, unlike the rest of this no-auth prototype - it calls the paid Anthropic API on every hit, so it's gated by `CRON_SECRET` (fails closed if unset) even though nothing else here requires a login.

## Assumptions & Trade-offs

- **Bold-formatting on "GOVERNMENT WARNING:" is not verified** - only that it's present and in all caps. Bold is a font-weight property that isn't reliably recoverable from OCR/vision text output; faking a confidence signal here seemed worse than being explicit that it's unverified and should be confirmed visually.
- **Three of TTB's mandatory label elements are not checked.** Name and address of the bottler or producer, country of origin for imports, and the sulfite declaration required on wine are all mandatory and all outside what this prototype verifies. The five fields it does check are the ones the assessment's example label enumerates; the rest would need extra application fields and a reworked extraction prompt rather than new comparison logic. Worth naming because they are real requirements, not oversights in the regulation.
- **Beverage-type rules cover alcohol content only.** The type resolved for each application drives the alcohol content rule and nothing else. Standards of fill, for instance, differ between wine and spirits (27 CFR 4.72 and 5.203) and net contents is checked against the application's own figure rather than against the permitted sizes.
- **The flavored malt beverage exception is surfaced, not decided.** A malt beverage must state its alcohol content if the alcohol comes from added nonbeverage flavors, and nothing on the label reliably says whether it does. The note on the field says so and leaves the call to the reviewer.
- **No COLA integration.** Per the IT stakeholder, this is a standalone proof-of-concept; COLA integration was explicitly described as a separate, much larger effort.
- **Low-quality images (angles, glare, poor lighting) aren't specially handled.** The stakeholder who raised this flagged it herself as possibly out of scope for a prototype; a bad photo will just produce lower-quality extraction or nulls, surfaced as "not found" (or, for the Government Warning specifically, "not shown") rather than a crash.
- **Imports are capped at 300 rows** (matching the "200, 300 label applications" figure from the interviews) - generous for the described scenario, but still a bound on an endpoint with no auth in front of it.
- **No true XLSX cell-embedded images** - the spreadsheet carries application data only; photos are attached per row while reviewing the import, not pulled out of the cells. Extracting embedded images is a meaningfully bigger and more fragile undertaking for the same practical outcome.
- **Import is deliberately slower than a bulk drop.** An earlier version matched a folder of images to rows by filename and created everything in one action. That was faster but it made attaching several photos to one application awkward, and it created rows from a sheet nobody had looked at. Walking the rows means an agent sees and can correct every application before it exists - the trade is throughput for the chance to catch a bad row before it enters the queue.
- **The upload-token endpoint is unauthenticated.** Vercel's guidance is to authenticate the user inside `onBeforeGenerateToken`; this prototype has no auth, so anyone who finds that endpoint can write to the Blob store within the type/size caps. That's a storage-abuse and cost vector, not only a data-exposure one - it's the one place where the no-auth posture has a consequence beyond visibility, and it would be the first thing to close in a real deployment.
- **No auth, one shared queue.** Anyone with the URL sees and can add to/delete from the same queue - fine for a single-reviewer prototype demo; a real multi-agent deployment would need accounts and permissions, plus the PII/retention review the IT stakeholder flagged.
- **Deployed on public infrastructure (Vercel) calling a public API (Anthropic).** The stakeholder interview mentioned TTB's real network blocks outbound calls to ML endpoints - a production deployment inside that network would need an on-prem or VPC-hosted model rather than a public API call. Not a concern for this prototype, since it isn't deployed inside TTB's network.
- **Matching thresholds (fuzzy-match similarity, ABV tolerance, net-contents tolerance) are reasonable defaults, not calibrated against real TTB adjudication data.** Each decision now stores which fields the automated check had flagged at the moment of sign-off, so an agent approving something the check flagged is recorded as exactly that - which is the data you'd tune these thresholds against once real reviewers have used it.
- **No component tests.** The comparison, matching, escalation, and spreadsheet logic have unit tests; the React components don't. Adding a browser test harness wasn't a good use of a two-day budget relative to covering the logic that decides outcomes, so the UI was verified by hand against the checklist in the implementation plan.

## Tech Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS v4, Public Sans (USWDS's own typeface), dark/light theming
- Neon Postgres (`@neondatabase/serverless`) for application records; Vercel Blob for label images
- Anthropic Claude - `claude-haiku-4-5` for label extraction, `claude-sonnet-5` for escalated second opinions - via `@anthropic-ai/sdk`
- `exceljs` for spreadsheet import parsing
- Vercel Cron for background-processing reliability
- Vitest for unit tests on the comparison/matching/escalation/spreadsheet logic
- Vercel for deployment
