# TTB Label Verification (Prototype)

Applications arrive with their label photos, every one is checked automatically against the label, and a TTB agent signs off on every one. The automated check never approves anything: it decides what an agent should look at first.

Live: https://treasury-assessment-hazel.vercel.app/

## Setup

Requires Node 20+, a Neon Postgres database, and a private Vercel Blob store. Both are one click each from the **Storage** tab of a Vercel project (**Marketplace** for Neon).

```bash
npm install
```

Create `.env.local` with `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, `ANTHROPIC_KEY` and `CRON_SECRET` (see [.env.example](.env.example)), or run `vercel env pull .env.local` after `vercel login`.

Apply the schema once, then start:

```bash
npm run db:migrate
npm run dev        # http://localhost:3000
```

Other scripts: `npm run build` / `npm start`, `npm test`, `npm run lint`.

## Try it

[public/sample-labels/](public/sample-labels/) has three products as front/back pairs and [public/sample-batch-template.csv](public/sample-batch-template.csv) has matching application data, including one deliberate ABV mismatch. For a larger set, `npm run gen:fixture` writes 40 applications to `test-batch/` covering every outcome the app can produce, with `test-batch/EXPECTED.md` listing what each row should return; `npm run seed` loads them into a running instance.

## Approach

**What I understood the job to be.** The brief describes agents reviewing applications, not agents running a tool. So I did not build a verification form that an agent points at a label. I built a queue: an application is checked the moment it is submitted, and by the time an agent opens it the answer is already there. Waiting for an agent to trigger a check they are going to want on every single application spends their time on a button press, and it puts a model call in front of a person who is trying to read. The 5-second bar in the brief is a real constraint on the submission path; it should not also be a constraint on the review path, and pre-checking is what takes it off.

**The AI does not decide.** It extracts what the label says, and the code compares that against what the application claims. An agent approves or rejects every application. This is not a hedge about model quality: an automated approval is an adjudication nobody can be held responsible for, and a federal one at that. The machine's output and the human's decision are deliberately different words in the schema (`clean` / `review` / `discrepancy` against `approved` / `rejected`) so the two can never be read as the same thing. There is no bulk approve, because a bulk approve turns sign-off into a gesture over applications nobody looked at.

**Two lists, split on the only question that matters:** has a person signed this off. The automated result is a sort order inside those lists, not a tab of its own. Giving it navigation invites reading it as a verdict.

**Because every application needs a person, throughput is the design problem.** The saving is entirely in how cheap one review is, so there is a dedicated Review tab that shows one application at a time, sized to fit the window so the buttons are never below the fold, offering approve, reject, or skip, with the next one loading as soon as a decision is recorded.

**A false flag costs more than it looks.** Three classes of them were worth building around:

- *Formatting is not a defect.* A label has to print "PRODUCED BY THE SMIRNOFF CO., NEW YORK, N.Y." and a person types "Smirnoff Co, New York, NY". Production phrases, corporate forms, and initialisms are reconciled before comparison, and country of origin the same way, so "MADE IN AMERICA" and "USA" agree while Mexico and Canada still do not.
- *An evidence gap is not a violation.* The Government Warning is usually on the back. The extraction reports whether any photo shows a face other than the front, so a warning absent from a front-only upload is reported as "not shown", which asks for a better photo, rather than as a missing warning.
- *A misread character is not a wording violation.* The warning comparison is tiered: identical passes, 97% or better is flagged as a likely transcription artifact, below that is a mismatch. Nothing short of identical is auto-cleared.

**Mandatory elements differ by product**, and alcohol content differs most: always required for spirits (27 CFR 5.65), required for wine with a table-wine exception (4.34), and not required for an ordinary malt beverage (7.63(a)(3)). Checking everything against the spirits rule flagged every compliant American beer. The app resolves a beverage type per application and applies the matching rule, and an undetermined type is never treated as "required".

**Technical choices.** Next.js on Vercel, Neon Postgres over HTTP (no connection pool to manage in a serverless path), Vercel Blob for photos. Claude Haiku does the extraction through a tool-use schema, so the model returns typed fields rather than prose to parse; comparison is ordinary deterministic code, because thresholds you can read and tune beat asking a model whether two strings mean the same thing. A field that does not cleanly match gets a second independent read from Sonnet, and a disagreement between the two models is shown to the reviewer rather than resolved automatically. Escalation triggers off our own match result, not a self-reported confidence score, which is not a calibrated signal. Photos upload from the browser straight to Blob because Vercel caps request bodies at 4.5MB and a real phone photo would 413 on the way through an API route. An import queues every row untouched and starts processing only once the whole sheet is handled, so an agent filling in row 12 is not competing with a dozen model calls. Median check time is 3.3s and p95 is 4.7s across 14 applications spanning clean reads and escalations, inside the 5-second bar; `npm run bench:verify` re-runs the measurement.

**For production, I would not deploy this as it stands.** A federal compliance tool should sit in AWS GovCloud, and the model call in particular should go to AWS Bedrock rather than a third-party API endpoint, so that label images and application data stay inside the accredited boundary. One stakeholder mentioned that TTB's network blocks outbound calls to ML endpoints, which points the same direction. If GovCloud were unavailable, self-hosting a model is possible, but it is a substantially larger project and I would want it scoped before promising it.

**On the direction of the project.** There were questions I would have asked that would have made this much clearer, and I have assumed answers to them instead:

- Do agents receive applications already checked, or trigger the check themselves? Everything above follows from assuming the former.
- Does the label arrive as a photograph, or as the print-ready artwork the applicant submits? If text is extractable from the artwork directly, vision is a fallback rather than the main path, and the accuracy ceiling is a different question entirely.
- Where does the application data come from? I assumed a form, but if it already lives in COLA then one side of every comparison is a system of record, and the shape of the tool changes.
- What happens to a rejection? Whether the reason goes back to the applicant or stays an internal note determines how much structure that field needs.

I understand this is an assessment rather than a product. If it were a product there are several pieces I would revise, starting with the ones in the next section. As a proof of concept, this is what I came up with.

## Tools

- Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, Public Sans (USWDS's typeface)
- Neon Postgres via `@neondatabase/serverless`, plain SQL, no ORM
- Vercel Blob (private store) for label images, Vercel Cron as a processing backstop
- Anthropic Claude via `@anthropic-ai/sdk`: `claude-haiku-4-5` for extraction, `claude-sonnet-5` for escalated second opinions
- `exceljs` for spreadsheet import, chosen over `xlsx`/SheetJS, which carries two unfixed advisories with no patched release
- Vitest for unit tests on the comparison, matching, escalation and spreadsheet logic

## Assumptions and trade-offs

- **No authentication, one shared queue.** Several things follow from this. A decision records what was decided, why, and when, but not who, because there is nobody to record. There is no check-out either, so two agents running the one-by-one review at once would be handed the same applications. In production, identity comes first and both of those follow from it.
- **The upload-token endpoint is unauthenticated**, which is where the no-auth posture actually costs something: anyone who finds it can write to the Blob store within the type and size caps. First thing to close in a real deployment.
- **No COLA integration.** Described in the interviews as a separate and much larger effort, so this is standalone.
- **Bold formatting on "GOVERNMENT WARNING:" is not verified**, only presence and capitalisation. Font weight is not reliably recoverable from vision output, and inventing a confidence signal for it seemed worse than saying so.
- **The wine sulfite declaration is not checked.** It is wine-only and would need its own application field. A real requirement, named here rather than quietly skipped.
- **Beverage-type rules cover alcohol content only.** Standards of fill also differ by product; net contents is checked against the application's own figure, not against the permitted sizes.
- **Matching thresholds are reasonable defaults, not calibrated** against real TTB adjudication data. Each decision stores which fields the check had flagged at the moment of sign-off, which is the data you would tune them against once real reviewers have used it.
- **Low-quality images are not specially handled.** A bad photo produces nulls, surfaced as "not found" or "not shown", which routes to asking for a better image rather than reporting a defect.
- **Imports are capped at 300 rows**, matching the volume described in the interviews.
- **Spreadsheets carry data, not embedded images.** Photos are attached per row during import. Pulling images out of cells is meaningfully more fragile for the same outcome.
- **No component tests.** The logic that decides outcomes is unit tested; the React components were verified by hand.
- **The "Add applications" tab is scaffolding.** In the real flow applications arrive from vendors; it exists so this can be demonstrated without one.
