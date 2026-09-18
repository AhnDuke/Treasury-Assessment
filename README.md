# TTB Label Verification (Prototype)

A prototype that checks a photographed alcohol beverage label against the data submitted with its application — brand name, class/type, ABV, net contents, and the federal Government Warning statement — in seconds. Built for the take-home assessment in [ASSESSMENT.md](ASSESSMENT.md).

## Live Demo

_TODO: add the deployed Vercel URL here._

## Setup & Run

Requires Node 20+.

```bash
npm install
cp .env.example .env.local   # then paste in a real ANTHROPIC_KEY
npm run dev                  # http://localhost:3000
```

Other scripts: `npm run build` / `npm start` (production build), `npm test` (unit tests), `npm run lint`.

## How It Works

**Single Label** — fill in the four fields from the application (brand name, class/type, ABV, net contents) and drop in a photo of the label. One Claude vision call reads the label and returns structured fields; those are compared against what you typed, and a results card shows each field as a match, a mismatch, not found, or needing review — with the submitted value and the extracted value side by side.

**Batch Upload** — for the "big importer dumps 200 applications at once" scenario. Upload a CSV of submitted data (one row per label — see the in-app template) alongside all the label images; each image is matched to its row by filename, verified the same way as a single label, and shown as a results table.

The Government Warning text is fixed by federal statute (27 CFR 16.21), so it isn't a form field — the app checks the label against the statutory wording directly.

## Approach & Technical Choices

- **Next.js (TypeScript, App Router) on Vercel, one call to Claude vision, no separate OCR/parsing pipeline.** The 5-second response bar (called out explicitly by the stakeholder) ruled out anything with multiple model round-trips or a separate OCR-then-parse stage; asking Claude to return structured fields directly via tool use gets extraction to one request. No database, no auth — the app is stateless request/response, matching the "don't store anything sensitive" prototype guidance.
- **Fuzzy matching on brand name and class/type, exact matching on the warning statement.** These two fields needed opposite treatment: the interviews gave a concrete example of a brand name that should *not* be flagged as different ("STONE'S THROW" vs "Stone's Throw" — same brand, different casing), while the warning statement was called out as needing to be exact, word-for-word, down to whether the header is capitalized. So brand/class-type use a normalized similarity score (case/punctuation-insensitive; near-misses land in "needs review" rather than a hard fail), while the warning statement is compared verbatim against the statutory text.
- **ABV and net contents get numeric comparison, not string comparison.** ABV is parsed to a number and compared with a small tolerance; net contents is parsed to a common unit (mL) so "750 mL" and "0.75 L" are recognized as equal.
- **Overall status is derived, not stored:** any mismatch/missing field rejects the label; any "needs review" field (without an outright mismatch) flags it; otherwise it's approved. The per-field detail is what an agent actually acts on — the overall banner is a summary, not a separate judgment call.

## Assumptions & Trade-offs

- **Bold-formatting on "GOVERNMENT WARNING:" is not verified** — only that it's present and in all caps. Bold is a font-weight property that isn't reliably recoverable from OCR/vision text output; faking a confidence signal here seemed worse than being explicit that it's unverified and should be confirmed visually.
- **No COLA integration.** Per the IT stakeholder, this is a standalone proof-of-concept; COLA integration was explicitly described as a separate, much larger effort.
- **Low-quality images (angles, glare, poor lighting) aren't specially handled.** The stakeholder who raised this flagged it herself as possibly out of scope for a prototype; a bad photo will just produce lower-quality extraction or nulls, surfaced as "not found" rather than a crash.
- **Batch mode is demo-scale (25 files/request), not the 200-300 file imports described.** A production version of that would need a job queue instead of processing an entire batch within one request/response cycle.
- **No auth, no persistence, no audit trail.** Nothing is stored — each request is independent. Fine for a prototype; a production deployment handling real applications would need both, plus the PII/retention review the IT stakeholder flagged.
- **Deployed on public infrastructure (Vercel) calling a public API (Anthropic).** The stakeholder interview mentioned TTB's real network blocks outbound calls to ML endpoints — a production deployment inside that network would need an on-prem or VPC-hosted model rather than a public API call. Not a concern for this prototype, since it isn't deployed inside TTB's network.
- **Matching thresholds (fuzzy-match similarity, ABV tolerance, net-contents tolerance) are reasonable defaults, not calibrated against real TTB adjudication data.**

## Tech Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS v4
- Anthropic Claude (`claude-haiku-4-5`) for label field extraction, via `@anthropic-ai/sdk`
- Vitest for unit tests on the comparison/matching/CSV logic
- Vercel for deployment
