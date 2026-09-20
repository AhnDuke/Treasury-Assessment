# TTB Label Verification

The assumption I worked under is that applications are submitted with their label photos, every application is checked automatically against the provided label, and a TTB agent decides to approve or reject the application based on the result. The automated check never approves anything, it streamlines checks and discovers discrepancies for the agent.

For the purposes of this prototype, an import application function was added to allow users to upload and create your own test cases.

Live: https://treasury-assessment-hazel.vercel.app/

## Setup

You need Node 20 or newer, a Vercel account, and an Anthropic API key. The database and the image storage both come from Vercel, and the free tier of each is more than enough to run this.

### 1. Install

```bash
git clone https://github.com/AhnDuke/Treasury-Assessment.git
cd Treasury-Assessment
npm install
```

### 2. Create the database and the image store

Sign in at [vercel.com](https://vercel.com), open a project or create an empty one, go to the **Storage** tab and click **Create Database**. You need two things from that list:

- **Neon** is the Postgres database that holds the application records. Create it, open it, and copy the connection string. That is your `DATABASE_URL`.
- **Blob** holds the label photos. Create it with access set to **private** rather than public. The app serves images through its own authenticated route and expects a private store, so a public one will not work. Copy the read and write token. That is your `BLOB_READ_WRITE_TOKEN`.

You do not have to deploy anything to use these. A Vercel project can exist purely to hold the storage while the app runs on your own machine.

### 3. Get an Anthropic API key

Create one at [console.anthropic.com](https://console.anthropic.com) under **API Keys**. That is your `ANTHROPIC_KEY`. Note the name: this project reads `ANTHROPIC_KEY`, not the `ANTHROPIC_API_KEY` that the SDK picks up by default.

### 4. Write the environment file

Create a file called `.env.local` in the project root, using [.env.example](.env.example) as a reference:

```bash
ANTHROPIC_KEY=sk-ant-...
DATABASE_URL=postgres://...
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
CRON_SECRET=any-random-string
```

`CRON_SECRET` can be any string you like. It only matters once the app is deployed, where Vercel's scheduled job sends it as a password to the endpoint that picks up unfinished work. That endpoint spends money on API calls, so it refuses every request that does not present the secret.

If you have the Vercel CLI and would rather not copy values by hand, `vercel login`, then `vercel link`, then `vercel env pull .env.local` will write the file for you. `ANTHROPIC_KEY` only comes down that way if you have already added it to the Vercel project.

### 5. Create the tables and start

```bash
npm run db:migrate
npm run dev
```

The app runs at http://localhost:3000. It opens with an empty queue, so see **Try it** below for sample applications to load into it.

Other scripts: `npm run build` and `npm start` for a production build, `npm test` for the unit tests, `npm run lint`.

### Deploying your own copy

Import the repository at [vercel.com/new](https://vercel.com/new), then add the same four variables under the project's **Settings, Environment Variables**, and deploy. If you created the storage inside that same project, `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` will already be there, and only `ANTHROPIC_KEY` and `CRON_SECRET` need adding.

## Try it

[public/sample-labels/](public/sample-labels/) has three products as front/back pairs and [public/sample-batch-template.csv](public/sample-batch-template.csv) has matching application data, including one deliberate ABV mismatch. For a larger set, `npm run gen:fixture` writes 40 applications to `test-batch/` covering every outcome the app can produce, with `test-batch/EXPECTED.md` listing what each row should return; `npm run seed` loads them into a running instance.

## Approach

**What I understood the job to be**  
The assessment README describes agents reviewing applications to confirm label information matches application information. The problem they face is one of efficiency, where a large amount of time and energy is spent on simple tasks that can be automated so that agents may refocus efforts on more complex problems. To assist in this, I built a tool that runs information verification on applications using AI before it reaches the user. It did not make sense to me to have the check run _after_ an agent calls for it, when we could offset that processing time to happen before the user needs to interact with it.

**The AI does not decide anything**  
It extracts what the label says, and the code compares that against what the application claims. An agent approves or rejects every application. There are two parts to this decision.

1. Mistakes happen even with the best models, so manual approval is a must.
2. An automated approval is a judgement nobody can be held responsible for, and a federal one at that. There is no bulk approve, because a bulk approve turns sign-off into a gesture over applications nobody looked at.

**Because every application needs a human signoff, throughput is the design problem**  
The time saving is entirely in how quick one review is, so there is a dedicated Review tab that shows one application at a time, sized to fit the window so the buttons are never below the fold, offering approve, reject, or skip, with the next one loading as soon as a decision is recorded. Users can quickly go through and review applications in a view that shows them exactly what is missing and what must be checked. They can also look for specific cases, should the need arise.

**A false flag costs more than it looks**  
Three classes of them were worth building around:

- _Formatting on an application is not a defect_  
  A label has to print "PRODUCED BY THE ALCOHOL CO., NEW YORK, N.Y." but a person could type "Alcohol Co, New York, NY" in their application. Production phrases, corporate forms, and initialisms are reconciled before comparison, and country of origin the same way, so "MADE IN AMERICA" and "USA" agree while Mexico and Canada still do not.

- _An evidence gap is not a violation_  
  The Government Warning is usually on the back. The extraction reports whether any photo shows a face other than the front, so a warning absent from a front-only upload is reported as "not shown", which asks for a better photo, rather than as an explicit missing warning.

- _A misread character is not a wording violation_  
  The warning comparison is tiered: identical passes, 97% or better is flagged as a likely transcription artifact, below that is a mismatch. Nothing short of identical is auto-cleared.

**Mandatory elements differ by product**  
Alcohol content differs most: always required for spirits, required for wine with a table-wine exception, and not required for an ordinary malt beverage. The app resolves a beverage type per application and applies the matching rule, and an undetermined type is never treated as "required".

**Technical choices**  
I built this on Next.js and deployed it to Vercel, with Neon Postgres holding the application records and Vercel Blob holding the label photos. Neon runs over HTTP, which means there is no connection pool to manage in a serverless request path. These are deliberately ordinary choices. The hard parts of this project are in the checking logic, and I did not want to spend the time budget on infrastructure that would never match what a federal tool needs to meet FedRAMP and other regulatory specifications.

Claude Haiku reads the label through a tool-use schema, so the model returns typed fields instead of text that would have to be parsed on my end. Everything after that point is ordinary code. I never ask the model whether two values mean the same thing. A threshold I can read and adjust is easier to trust, and easier to correct, than a judgement made somewhere I cannot see.

I used Claude Haiku rather than a dedicated text extraction service like AWS Textract, Google Vision, or Azure Read, mostly for speed of development. Haiku reads the label and works out what each piece of text means in the same call, which a text extraction service cannot do on its own. At this scale the difference in cost and speed between the two approaches is small enough that it did not decide anything. In production I would look at splitting the work rather than picking one. Dedicated OCR is better at exact character transcription, which is the part that matters most for the Government Warning, since that gets compared word for word against statute. What it cannot do is tell me whether an image shows the back of the bottle at all, and that judgement is what separates a genuinely missing warning from a label nobody photographed the back of. That is a vision question, not a text extraction one. Splitting along that line is the version of this I would build next.

When a field does not cleanly match, it gets a second and independent read from Claude Sonnet. If the two models disagree, the reviewer is shown that they disagree. The app does not pick a winner. What triggers that second read is our own comparison result rather than the model's opinion of its own confidence, since self-reported confidence is not a calibrated signal.

Two smaller decisions came out of hitting real limits:

1. Photos upload from the browser straight to Blob. Vercel caps request bodies at 4.5MB, so a real phone photo would fail on the way through an API route.
2. When importing multiple test applications, it queues every row for file upload and only starts the AI check once the whole sheet has been handled. Otherwise an incomplete submission or other bug can cause duplicate uploads and additional cleanup work.

**Speed was a stated requirement**  
One of the interviews put a hard number on it: if results take more than about five seconds, nobody will use the tool. I measured it across 14 applications, mixing straightforward labels with ones that needed a second look. Most finished in a little over three seconds and the slowest came in under five, so the bar holds even in the worst case. In practice an agent rarely waits at all, since the check already ran when the application arrived. `npm run bench:verify` runs the measurement again.

**For production, I would not deploy this in this form**  
A federal compliance tool should sit in AWS GovCloud and comply with FedRAMP, and the model call in particular should go to AWS Bedrock rather than a third-party API endpoint, so that label images and application data remain compliant with guidelines. One stakeholder mentioned that TTB's network blocks outbound calls to ML endpoints, which points the same direction. If GovCloud were unavailable, self-hosting a model is possible, but it is a substantially larger project and would need for it to be scoped before planning.

**On the direction of the project**  
There were questions I would have asked that would have made this much clearer, but I have assumed answers to them instead for this assessment:

- Where and how are applications retrieved and formatted?

- Does the label arrive as a photograph of the bottle, as a print-ready artwork the applicant submits, or sometimes both? If text is extractable from the artwork directly, vision is a fallback rather than the main path, and the accuracy ceiling is a different question entirely.

- Should this tool manage follow ups to rejections automatically, or is that something the Agent must manually do?

- Coming from a manufacturing background, audit trails are extremely important. Given that I assume the same for federal work, would this project have to tie into the existing IAM / Auth system to allow for precise tracking and access control to the tool?

## Tools

- Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, Public Sans (USWDS's typeface)

- Neon Postgres via `@neondatabase/serverless`, plain SQL, no ORM

- Vercel Blob (private store) for label images, Vercel Cron as a processing backstop

- Anthropic Claude via `@anthropic-ai/sdk`: `claude-haiku-4-5` for extraction, `claude-sonnet-5` for escalated second opinions

- `exceljs` for spreadsheet import, chosen over `xlsx`/SheetJS, which carries two unfixed advisories with no patched release

- Vitest for unit tests on the comparison, matching, escalation and spreadsheet logic

## Assumptions and trade-offs

- **No authentication, one shared queue**  
  Several things follow from this. A decision records what was decided, why, and when, but not who, because there is nobody to record. There is no check-out either, so two agents running the one-by-one review at once would be handed the same applications. In production, identity comes first and both of those follow from it.

- **The upload token endpoint is unauthenticated**  
  This is where the no-auth posture actually costs something. Anyone who finds it can write to the Blob store within the type and size caps. First thing to close in a real deployment.

- **Bold formatting on "GOVERNMENT WARNING:" is not verified**  
  Only presence and capitalization. Font weight is not reliably recoverable from Claude's vision output, and generating a self-reported signal is inadvisable and inconsistent.

- **The wine sulfite declaration is not checked**  
  It is wine-only and would need its own application field.

- **Beverage-type rules cover alcohol content only**  
  Standards of fill also differ by product; net contents is checked against the application's own figure, not against the permitted sizes.

- **Matching thresholds are reasonable defaults, not calibrated against real TTB adjudication data**  
  Each decision stores which fields the check had flagged at the moment of sign-off, which is the data you would tune them against once real reviewers have used it.

- **Low-quality images are not specially handled**  
  A bad photo produces nulls, surfaced as "not found" or "not shown", which routes to asking for a better image rather than reporting a defect. This is just a limitation of technology and not something that can be quickly, cheaply, and reliably remedied. While there are ways of manipulating image data to potentially recover and view information that may be obscured by a bad photo, it is just far more efficient to request a new photo.

- **Imports are capped at 300 rows**  
  Since this is a feature specifically included for importing test cases in this demo.

- **Spreadsheets carry data, not embedded images**  
  Photos are attached per row during import. Pulling images out of cells is meaningfully more fragile for the same outcome.
