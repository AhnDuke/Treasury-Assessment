# Agent Review Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the prototype so a compliance agent works a triaged queue — opening an application in a modal that shows its fields and label photos side by side, then approving or rejecting it — with the AI acting as a pre-filter that sorts and marks suspect fields rather than deciding anything.

**Architecture:** The verification pipeline is unchanged; what changes is that its verdict is renamed to a *triage* signal (never a decision), a separate human *decision* is persisted alongside it, and the UI is reorganized into decision-stage tabs over a searchable, sortable list. Two new API routes support this: one to record a decision, one to proxy private Blob images into the browser so the modal can display them.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, Neon Postgres (`@neondatabase/serverless`), Vercel Blob, Anthropic SDK, Vitest.

**Spec:** [ASSESSMENT.md](../../../ASSESSMENT.md) plus the design decisions recorded in "Spec" below. This plan supersedes the earlier multi-image plan, which is complete except for its image-count rule (revised here).

---

## Spec

The assessment describes the job this way: *"An agent pulls up an application, looks at the label artwork, and checks that what's on the label matches what's in the application."* The current prototype approximates that; this plan implements it literally.

**S1. The AI never decides.** Its output is a triage signal that sorts work and marks suspect fields. Every application is adjudicated by a human. This is the answer to Dave Morrison's *"You can't just pattern match everything... You need judgment."*

**S2. Two axes, not one.** `triage_status` (what the AI thinks) and `decision` (what the agent ruled) are separate columns and separate vocabularies. The word "approved" means a human approved it, and nothing else. The current schema uses `overall_status IN ('approved','flagged','rejected')` for the AI verdict, which would collide head-on with the human decision — hence the rename in Task 3.

**S3. Five tabs, in workflow order:** Clean matches -> Needs attention -> Approved -> Rejected -> Not ready. The first two are work to do (no decision recorded yet), split by triage signal. The next two are work done. The fifth holds applications that are still processing, cancelled, or errored — they must stay visible, because an application that silently vanishes from every tab is never adjudicated.

**S4. Rejection requires a reason; approval does not.** Jenny Park's *"I caught one last month where they used 'Government Warning' in title case instead of all caps. Rejected"* implies a recorded basis. The reason field is pre-filled from the flagged fields so the common path stays fast.

**S5. Decisions record what the AI said at the time.** An agent approving something the AI flagged is the most valuable signal the system produces — it is the calibration data for the thresholds the README currently admits are uncalibrated.

**S6. 1-3 images.** One image is legitimate: an applicant may supply a single composite photo showing front and back together. Image *count* therefore tells us nothing about what was actually photographed.

**S7. Evidence gaps are not label defects.** The extraction call reports whether any supplied image shows a back/reverse/side view. A missing Government Warning with a back view present is a violation; a missing Government Warning with no back view present is "can't verify — request a better photo," which the assessment names as a real workflow step (*"if an agent can't read the label they just reject it and ask for a better image"*). Same principle already applied to transcription artifacts: never report a measurement gap as a finding against the label.

**Scope note on S7:** the `not_shown` status is defined generally and the UI renders it for any field, but the warning statement is the only field that produces it, because it is the only field for which we have a view-visibility signal. Extending it to other fields (bottler name and address is the obvious next one) would need its own evidence signal and is out of scope here.

## Global Constraints

- **Node 20+**, Next.js `16.3.5`, React `19.2.8` — do not change versions.
- **No new runtime dependencies.** Use the native `<dialog>` element and `<datalist>` rather than a component library; this is deliberate (accessibility behavior handled by the browser, nothing to keep current).
- **`db/schema.sql` is executed by `scripts/migrate.mjs`, which splits on `;` and cannot handle `DO` blocks or functions.** Every statement must be plain, sequential, and idempotent — `npm run db:migrate` is re-run against live data.
- **UI copy targets the assessment's stated audience** (*"Clean, obvious, no hunting for buttons"* / *"something my mother could figure out"*). No jargon, no abbreviations, sentence case, verbs that say what will happen.
- **Status glyphs are plain typographic characters, not emoji** — see the comment at the top of `src/lib/statusMeta.ts`.
- **Colors come from the existing tokens only:** `paper`, `paper-muted`, `ink`, `ink-muted`, `border`, `seal`, `seal-dark`, `verified`/`-bg`/`-border`, `flag`/`-bg`/`-border`, `reject`/`-bg`/`-border`. Do not introduce new CSS variables.
- **Commits: lowercase, short, imperative.** No `Co-Authored-By` trailer. Never stage `CLAUDE.md` or `AGENTS.md`.
- Verification commands: `npm test`, `npx tsc --noEmit`, `npx eslint src`, `npm run build`.

## File Structure

**Created:**
- `src/app/api/applications/[id]/decision/route.ts` — records an agent's approve/reject.
- `src/app/api/applications/[id]/images/[index]/route.ts` — streams a private Blob image to the browser.
- `src/components/ReviewModal.tsx` — the review surface: fields with match markers, photos, decision buttons.
- `src/components/ReviewQueue.tsx` — tabs, search, sort, counts, list. Replaces `ApplicationQueue.tsx`.

**Modified:**
- `src/lib/types.ts` — `FieldStatus` gains `not_shown`; `OverallStatus` -> `TriageStatus`; `ReviewDecision` added; image constants change; `ApplicationRecord` gains decision fields.
- `src/lib/anthropic.ts` — extraction schema gains `backLabelVisible`.
- `src/lib/comparison.ts` — warning check branches on `backLabelVisible`; `determineOverallStatus` -> `determineTriageStatus`.
- `src/lib/escalation.ts` — `not_shown` fields don't earn a second-opinion call.
- `src/lib/statusMeta.ts` — `not_shown` meta, `TRIAGE_STATUS_META`, `DECISION_META`.
- `src/lib/db.ts` — decision columns in the row mapper; `recordDecision`.
- `src/lib/imagePayload.ts`, `src/lib/uploadImages.ts`, `src/lib/spreadsheet.ts` — 1-3 image counts.
- `src/components/VerifierApp.tsx` — review is the primary view; add/import demoted.
- `src/components/ResultsCard.tsx`, `AddSingleApplication.tsx`, `ImportApplications.tsx` — renamed prop.
- `db/schema.sql` — triage rename + decision columns.
- `README.md` — the workflow, the two-axis vocabulary, the evidence-gap rule.

**Deleted:**
- `src/components/ApplicationQueue.tsx` (superseded by `ReviewQueue.tsx` in Task 8).

---

### Task 0: Make the migration genuinely re-runnable

Added during the pre-flight scan, after verifying the failure rather than inferring it. `npm run db:migrate` currently fails on any run after the first:

```
NeonDbError: column "image_url" does not exist   (SQLSTATE 42703)
```

The images backfill reads `image_url` in a statement that a later statement drops, so the file works exactly once — yet its own comment claims it is safe to re-run, and this plan's Global Constraints depend on that being true. Tasks 3 and 4 both run the migration and would both fail here.

The fix reads legacy columns through `to_jsonb(applications)->>'column_name'`, which parses whether or not the column still exists and evaluates to NULL once it is gone. No `DO` block, no runner change, no annotation scheme — the one-file architecture the runner requires is preserved.

**Files:**
- Modify: `db/schema.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: a `db/schema.sql` that can be applied repeatedly. Tasks 3 and 4 depend on this.

- [ ] **Step 1: Confirm the failure first**

Run: `npm run db:migrate`
Expected: FAIL with `column "image_url" does not exist`. If it succeeds, the database predates the images migration — say so in the report and continue anyway; the fix is still correct.

- [ ] **Step 2: Rewrite the images backfill**

In `db/schema.sql`, replace the `UPDATE applications SET images = ...` statement and the comment block above it:

```sql
-- Migration: one image per application -> many (front, back, ...).
-- These run after the CREATE TABLE above rather than replacing its columns,
-- so the backfill below always has the legacy columns to read from — on a
-- fresh database they're created and then dropped, on an existing one the
-- rows are migrated. (The runner executes statements in order and can't
-- handle DO blocks, which is why this is plain sequential DDL.)
--
-- The backfill reads the legacy columns through to_jsonb(applications)
-- rather than naming them directly. A direct reference stops parsing once
-- the DROP below has run, which made this file fail on every run after the
-- first with `column "image_url" does not exist` — the opposite of the
-- idempotence it claimed. Through to_jsonb the statement parses either way
-- and simply matches no rows once the columns are gone.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS images JSONB;

UPDATE applications
SET images = jsonb_build_array(
  jsonb_build_object(
    'url', to_jsonb(applications) ->> 'image_url',
    'filename', to_jsonb(applications) ->> 'image_filename',
    'contentType', to_jsonb(applications) ->> 'image_content_type'
  )
)
WHERE images IS NULL AND to_jsonb(applications) ->> 'image_url' IS NOT NULL;
```

The three `DROP COLUMN IF EXISTS` statements below it are already idempotent — leave them alone.

- [ ] **Step 3: Verify it is now re-runnable**

Run: `npm run db:migrate && npm run db:migrate`
Expected: both runs complete, each printing `Applied N statement(s) from schema.sql.` with no error.

- [ ] **Step 4: Verify the backfill still works on legacy data**

The rewrite must not have turned the backfill into a silent no-op. Confirm no row lost its images:

```bash
node --env-file-if-exists=.env.local -e "const{neon}=require('@neondatabase/serverless');neon(process.env.DATABASE_URL)\`SELECT count(*)::int AS total, count(images)::int AS with_images FROM applications\`.then(r=>console.log(r[0]))"
```

Expected: `total` and `with_images` are equal. Report both numbers.

- [ ] **Step 5: Commit**

```bash
git add db/schema.sql
git commit -m "make the schema backfill survive a second migration run"
```

---

### Task 1: Evidence gaps — the `not_shown` field status

The Government Warning is nearly always on the back label. When no image shows a back view, a missing warning is an evidence gap, not a violation. This task adds the signal and the distinct status it drives.

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/anthropic.ts`
- Modify: `src/lib/comparison.ts`
- Modify: `src/lib/escalation.ts`
- Modify: `src/lib/statusMeta.ts`
- Test: `src/lib/comparison.test.ts`, `src/lib/escalation.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `FieldStatus` including `"not_shown"`; `ExtractedLabelData.backLabelVisible: boolean`. `compareLabelToApplication(expected: ApplicationData, extracted: ExtractedLabelData): FieldResult[]` keeps its signature — the new flag rides on `extracted`.

- [ ] **Step 1: Add the new status and extraction field to the type module**

In `src/lib/types.ts`, change the `FieldStatus` union:

```ts
export type FieldStatus = "match" | "review" | "mismatch" | "missing" | "not_shown";
```

and add one field to `ExtractedLabelData`:

```ts
export interface ExtractedLabelData {
  brandName: string | null;
  classType: string | null;
  abvPercent: number | null;
  netContents: string | null;
  warningStatementText: string | null;
  /**
   * Whether any supplied image shows a face other than the front. Drives the
   * distinction between "the label is missing the warning" (a violation) and
   * "nobody photographed the side it's printed on" (an evidence gap) — see
   * compareWarningStatement.
   */
  backLabelVisible: boolean;
}
```

- [ ] **Step 2: Update the existing test helper so the suite still type-checks**

`extracted()` in `src/lib/comparison.test.ts` builds an `ExtractedLabelData`, so it must supply the new required field. The existing tests all assume a full set of photos, so the default is `true`:

```ts
function extracted(overrides: Partial<ExtractedLabelData> = {}): ExtractedLabelData {
  return {
    brandName: "OLD TOM DISTILLERY",
    classType: "Kentucky Straight Bourbon Whiskey",
    abvPercent: 45,
    netContents: "750 mL",
    warningStatementText: STATUTORY_WARNING_TEXT,
    backLabelVisible: true,
    ...overrides,
  };
}
```

- [ ] **Step 3: Write the failing tests**

Append to the `describe("compareLabelToApplication", ...)` block in `src/lib/comparison.test.ts`:

```ts
  it("reports a missing warning as an evidence gap when no back view was supplied", () => {
    // A single front photo genuinely doesn't contain the warning. Calling
    // that a violation is what manufactured false "missing warning" reports.
    const fields = compareLabelToApplication(
      application,
      extracted({ warningStatementText: null, backLabelVisible: false })
    );
    const warning = fields.find((f) => f.field === "warningStatement")!;
    expect(warning.status).toBe("not_shown");
    expect(warning.detail).toContain("back");
  });

  it("reports a missing warning as a genuine omission when a back view was supplied", () => {
    const fields = compareLabelToApplication(
      application,
      extracted({ warningStatementText: null, backLabelVisible: true })
    );
    expect(fields.find((f) => f.field === "warningStatement")!.status).toBe("missing");
  });
```

Append to `src/lib/escalation.test.ts`, inside `describe("fieldsNeedingSecondOpinion", ...)`:

```ts
  it("doesn't spend a second-opinion call on a field nobody photographed", () => {
    // A stronger model re-reading the same images can't find text that isn't
    // in them — escalating an evidence gap buys nothing and costs a call.
    const fields = [
      field({ field: "warningStatement", status: "not_shown" }),
      field({ field: "classType", status: "review" }),
    ];
    expect(fieldsNeedingSecondOpinion(fields)).toEqual(["classType"]);
  });
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL. The evidence-gap test fails with `expected 'missing' to be 'not_shown'`; the escalation test fails with `expected [ 'warningStatement', 'classType' ] to deeply equal [ 'classType' ]`.

- [ ] **Step 5: Add `backLabelVisible` to the extraction tool schema**

In `src/lib/anthropic.ts`, add an entry to `FIELD_PROPERTIES` after `warningStatementText` (the declared value type `{ type: (string | null)[]; description: string }` already accepts this):

```ts
  backLabelVisible: {
    type: ["boolean"],
    description:
      "True if ANY supplied image shows a face of the packaging other than the primary front label - a back, reverse, side, or neck label - including a single image that shows front and back together. False if every image shows only the front.",
  },
```

Do **not** add `backLabelVisible` to `FIELD_TO_EXTRACTION_KEY`: that map is keyed by *compared* fields, and this one is evidence about the photos rather than a value to compare against the application.

Extend `SHARED_INSTRUCTIONS` with one sentence, placed immediately before the closing sentence about null:

```
Also report whether any image shows a face other than the front of the packaging, so that a field which is absent can be distinguished from a face nobody photographed.
```

- [ ] **Step 6: Branch the warning comparison on the evidence**

In `src/lib/comparison.ts`, change `compareWarningStatement`'s signature and its null branch. Everything after the null branch is unchanged:

```ts
function compareWarningStatement(extracted: string | null, backLabelVisible: boolean): FieldResult {
  const label = "Government Warning Statement";
  const expected = STATUTORY_WARNING_TEXT;
  if (!extracted || !extracted.trim()) {
    // Two different findings share one symptom. The warning is printed on the
    // back or side in nearly every case, so "not found" means one thing when
    // we were shown that side and something else entirely when we weren't.
    // Reporting an evidence gap as a violation is what produced the false
    // "missing warning" results this check was rewritten to fix.
    if (!backLabelVisible) {
      return {
        field: "warningStatement",
        label,
        expected,
        extracted: null,
        status: "not_shown",
        detail:
          "No photo shows the back or side of the packaging, where this statement is almost always printed. This is not a finding against the label — request a photo of the back before deciding.",
      };
    }
    return {
      field: "warningStatement",
      label,
      expected,
      extracted: null,
      status: "missing",
      detail: "A back or side view was supplied and carries no warning statement — this is a genuine omission.",
    };
  }
```

Update the call site in `compareLabelToApplication`:

```ts
    compareWarningStatement(extracted.warningStatementText, extracted.backLabelVisible),
```

And in `determineOverallStatus`, an evidence gap must not read as a rejection — it belongs with the other things needing a human:

```ts
export function determineOverallStatus(fields: FieldResult[]): OverallStatus {
  if (fields.length === 0) return "rejected";
  if (fields.some((f) => f.status === "mismatch" || f.status === "missing")) return "rejected";
  if (fields.some((f) => f.status === "review" || f.status === "not_shown")) return "flagged";
  return "approved";
}
```

(This function is renamed in Task 3. Leave the name alone here.)

- [ ] **Step 7: Stop escalating fields nobody photographed**

In `src/lib/escalation.ts`:

```ts
export function fieldsNeedingSecondOpinion(fields: FieldResult[]): string[] {
  // not_shown is excluded deliberately: a stronger model re-reading the same
  // images cannot find text that isn't in them, so escalating an evidence gap
  // buys nothing and costs a Sonnet call.
  return fields
    .filter((f) => f.status !== "match" && f.status !== "not_shown")
    .map((f) => f.field);
}
```

- [ ] **Step 8: Give the new status a visual treatment**

In `src/lib/statusMeta.ts`, add to `FIELD_STATUS_META`. Neutral tokens, not `reject` — the whole point is that this isn't a finding against the label:

```ts
  not_shown: { glyph: "–", label: "Not shown", className: "text-ink-muted bg-paper-muted border-border", edgeClassName: "border-l-border" },
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, all suites.

- [ ] **Step 10: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src`
Expected: no output from either.

- [ ] **Step 11: Commit**

```bash
git add src/lib/types.ts src/lib/anthropic.ts src/lib/comparison.ts src/lib/escalation.ts src/lib/statusMeta.ts src/lib/comparison.test.ts src/lib/escalation.test.ts
git commit -m "distinguish a missing warning from an unphotographed back label"
```

---

### Task 2: Allow 1-3 label photos

One image can legitimately be a composite showing front and back. The minimum drops to 1 and the maximum to 3; the evidence-gap rule from Task 1 is what now protects against a front-only photo, so the count no longer has to.

**Files:**
- Modify: `src/lib/types.ts` (the two image constants)
- Modify: `src/lib/uploadImages.ts` (`describeImageCountProblem`)
- Modify: `src/lib/imagePayload.ts` (`validateImages`)
- Modify: `src/lib/spreadsheet.ts` (`rowToImportRow`)
- Modify: `src/components/AddSingleApplication.tsx` (helper copy)
- Test: `src/lib/spreadsheet.test.ts`

**Interfaces:**
- Consumes: Task 1's `not_shown` status — this change is only safe because that exists.
- Produces: `MIN_IMAGES_PER_APPLICATION = 1`, `MAX_IMAGES_PER_APPLICATION = 3`.

- [ ] **Step 1: Write the failing tests**

In `src/lib/spreadsheet.test.ts`, replace the test named `"requires at least two images, since the warning is usually on the back"` with:

```ts
  it("accepts a single filename, which may be a composite front-and-back photo", () => {
    const result = rowToImportRow({ ...base, filenames: "front-and-back.jpg" }, 4);
    expect(result).toEqual({
      row: {
        filenames: ["front-and-back.jpg"],
        data: { brandName: "OLD TOM DISTILLERY", classType: "Bourbon", abvPercent: 45, netContents: "750 mL" },
      },
    });
  });
```

and replace `"rejects more than five images"` with:

```ts
  it("rejects more than three images", () => {
    const result = rowToImportRow({ ...base, filenames: "a.jpg;b.jpg;c.jpg;d.jpg" }, 5);
    expect("error" in result && result.error).toContain("more than 3 images");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — the single-filename test gets `{ error: 'Row 4 (front-and-back.jpg): needs at least 2 images...' }`, and the four-image test finds no error at all.

- [ ] **Step 3: Change the constants**

In `src/lib/types.ts`:

```ts
// One image is allowed because an applicant may supply a single composite
// photo showing front and back together. A front-only photo is caught by the
// evidence-gap check in comparison.ts, not by a count rule — the count never
// told us what was actually photographed.
export const MIN_IMAGES_PER_APPLICATION = 1;
export const MAX_IMAGES_PER_APPLICATION = 3;
```

- [ ] **Step 4: Update the messages that hard-code the old counts**

`src/lib/uploadImages.ts`:

```ts
export function describeImageCountProblem(count: number): string | null {
  if (count < MIN_IMAGES_PER_APPLICATION) {
    return "Add at least one label photo.";
  }
  if (count > MAX_IMAGES_PER_APPLICATION) {
    return `Up to ${MAX_IMAGES_PER_APPLICATION} photos per application.`;
  }
  return null;
}
```

`src/lib/imagePayload.ts`:

```ts
  if (value.length < MIN_IMAGES_PER_APPLICATION) {
    return { error: "Add at least one label photo." };
  }
  if (value.length > MAX_IMAGES_PER_APPLICATION) {
    return { error: `Up to ${MAX_IMAGES_PER_APPLICATION} label photos per application.` };
  }
```

`src/lib/spreadsheet.ts` — the `< MIN` branch is now unreachable for a non-empty list (the `filenames.length === 0` check above it already covers zero), but keep it so the rule survives a future constant change:

```ts
  if (filenames.length < MIN_IMAGES_PER_APPLICATION) {
    return { error: `Row ${rowIndex} (${label}): needs at least ${MIN_IMAGES_PER_APPLICATION} image(s), separated by ";".` };
  }
  if (filenames.length > MAX_IMAGES_PER_APPLICATION) {
    return { error: `Row ${rowIndex} (${label}): more than ${MAX_IMAGES_PER_APPLICATION} images.` };
  }
```

- [ ] **Step 5: Update the form's guidance copy**

In `src/components/AddSingleApplication.tsx`, find the label-photos section heading and the hint text near it that references "2-5" or "at least 2". Replace the hint with:

```tsx
            Add up to {MAX_IMAGES_PER_APPLICATION} photos. Include the back label if the Government Warning isn&apos;t
            visible on the front — one photo showing both sides works too.
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, all suites.

- [ ] **Step 7: Type-check, lint, and build**

Run: `npx tsc --noEmit && npx eslint src && npm run build`
Expected: clean; the build prints its route table with no errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/types.ts src/lib/uploadImages.ts src/lib/imagePayload.ts src/lib/spreadsheet.ts src/lib/spreadsheet.test.ts src/components/AddSingleApplication.tsx
git commit -m "allow one to three label photos per application"
```

---

### Task 3: Rename the AI verdict to a triage signal

`OverallStatus = "approved" | "flagged" | "rejected"` is the AI's verdict. Once agents also approve and reject, that vocabulary collides: "Approved" would mean two unrelated things in the same interface, for an audience benchmarked against someone who *"just learned to video call her grandkids last year."* The AI's verdict becomes `TriageStatus = "clean" | "review" | "discrepancy"`, and approve/reject is reserved for people.

Three values are kept rather than collapsing to two so severity survives for sorting; the "Needs attention" tab shows `review` and `discrepancy` together.

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/comparison.ts`
- Modify: `src/lib/statusMeta.ts`
- Modify: `src/lib/db.ts`
- Modify: `db/schema.sql`
- Modify: `src/components/ResultsCard.tsx`, `src/components/ApplicationQueue.tsx`, `src/components/AddSingleApplication.tsx`, `src/components/ImportApplications.tsx`
- Test: `src/lib/comparison.test.ts`

**Interfaces:**
- Consumes: Task 1's `not_shown` status.
- Produces:
  - `export type TriageStatus = "clean" | "review" | "discrepancy";`
  - `determineTriageStatus(fields: FieldResult[]): TriageStatus`
  - `VerificationOutcome.triageStatus: TriageStatus` (was `overallStatus`)
  - `ApplicationRecord.triageStatus: TriageStatus | null` (was `overallStatus`)
  - `TRIAGE_STATUS_META: Record<TriageStatus, { glyph, label, shortLabel, className, edgeClassName }>`
  - `updateApplicationResult(id, { status, triageStatus?, fields?, errorMessage? })`
  - DB column `triage_status`

- [ ] **Step 1: Write the failing test**

In `src/lib/comparison.test.ts`, update the import and every `determineOverallStatus` assertion. The four existing call sites map as: `"approved"` -> `"clean"`, `"flagged"` -> `"review"`, `"rejected"` -> `"discrepancy"`.

```ts
import { compareLabelToApplication, determineTriageStatus } from "./comparison";
```

Then add one test that pins the new vocabulary explicitly:

```ts
describe("determineTriageStatus", () => {
  it("separates a clean read from one needing attention from one with a hard discrepancy", () => {
    // These three values are the AI's triage signal, never a decision — an
    // agent's approve/reject is recorded separately. Keeping the vocabularies
    // apart is the point of the names.
    expect(determineTriageStatus(compareLabelToApplication(application, extracted()))).toBe("clean");
    expect(
      determineTriageStatus(
        compareLabelToApplication(application, extracted({ classType: "Kentucky Straight Bourban Whiskey" }))
      )
    ).toBe("review");
    expect(
      determineTriageStatus(compareLabelToApplication(application, extracted({ abvPercent: 40 })))
    ).toBe("discrepancy");
  });

  it("routes an unphotographed field to attention, not to a discrepancy", () => {
    const fields = compareLabelToApplication(
      application,
      extracted({ warningStatementText: null, backLabelVisible: false })
    );
    expect(determineTriageStatus(fields)).toBe("review");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL with `No "determineTriageStatus" export is defined on the "./comparison" mock` or a TypeScript import error.

- [ ] **Step 3: Rename the type**

In `src/lib/types.ts`, replace the `OverallStatus` declaration:

```ts
/**
 * What the automated check thinks of an application — a triage signal used to
 * sort the queue, never a decision. A person's approve/reject is recorded
 * separately as ReviewDecision, and the two deliberately use different words.
 */
export type TriageStatus = "clean" | "review" | "discrepancy";
```

Update the two places it's referenced in that file:

```ts
export interface VerificationOutcome {
  triageStatus: TriageStatus;
  fields: FieldResult[];
}
```

```ts
  triageStatus: TriageStatus | null;
```

(in `ApplicationRecord`, replacing `overallStatus: OverallStatus | null;`)

- [ ] **Step 4: Rename the function**

In `src/lib/comparison.ts`, change the import from `./types` to bring in `TriageStatus` instead of `OverallStatus`, then:

```ts
export function determineTriageStatus(fields: FieldResult[]): TriageStatus {
  if (fields.length === 0) return "discrepancy";
  if (fields.some((f) => f.status === "mismatch" || f.status === "missing")) return "discrepancy";
  if (fields.some((f) => f.status === "review" || f.status === "not_shown")) return "review";
  return "clean";
}
```

- [ ] **Step 5: Rename the status metadata**

In `src/lib/statusMeta.ts`, replace `OVERALL_STATUS_META` entirely. `shortLabel` is new — the queue currently strips the long form with a regex (`meta.label.replace(/ —.*/, "")`), which is fragile; give it a real field instead:

```ts
export const TRIAGE_STATUS_META: Record<
  TriageStatus,
  { glyph: string; label: string; shortLabel: string; className: string; edgeClassName: string }
> = {
  clean: {
    glyph: "✓",
    label: "Clean match — every field agrees with the application",
    shortLabel: "Clean match",
    className: "text-verified bg-verified-bg border-verified-border",
    edgeClassName: "border-l-verified",
  },
  review: {
    glyph: "!",
    label: "Needs attention — some fields could not be confirmed",
    shortLabel: "Needs attention",
    className: "text-flag bg-flag-bg border-flag-border",
    edgeClassName: "border-l-flag",
  },
  discrepancy: {
    glyph: "✕",
    label: "Needs attention — the label disagrees with the application",
    shortLabel: "Discrepancy",
    className: "text-reject bg-reject-bg border-reject-border",
    edgeClassName: "border-l-reject",
  },
};
```

Update the file's import line to `import type { FieldStatus, TriageStatus } from "./types";`.

- [ ] **Step 6: Migrate the database column**

Append to `db/schema.sql`. Follow the existing multi-image migration's shape — the column is declared in `CREATE TABLE` for fresh databases and added by `ALTER` for existing ones:

```sql
-- Migration: the automated verdict is a triage signal, not a decision.
-- "approved"/"rejected" now belong exclusively to a human reviewer's
-- decision (added below), so the automated column is renamed and revalued to
-- keep the two vocabularies from colliding in the UI.
--
-- Note the asymmetry: a fresh database gets triage_status from the CREATE
-- TABLE above, with its CHECK constraint; an existing database gets it from
-- the ALTER here, without one. Postgres has no `ADD CONSTRAINT IF NOT
-- EXISTS`, and this file must stay re-runnable, so the constraint is not
-- retrofitted. Writes go through updateApplicationResult in src/lib/db.ts,
-- which is typed to TriageStatus.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS triage_status TEXT;

-- Reads overall_status through to_jsonb(applications) rather than naming it,
-- for the same reason as the images backfill above: a direct reference stops
-- parsing once the DROP below has run, which would make this file fail on
-- every subsequent migration. See Task 0.
UPDATE applications
SET triage_status = CASE to_jsonb(applications) ->> 'overall_status'
  WHEN 'approved' THEN 'clean'
  WHEN 'flagged' THEN 'review'
  WHEN 'rejected' THEN 'discrepancy'
END
WHERE triage_status IS NULL AND to_jsonb(applications) ->> 'overall_status' IS NOT NULL;

ALTER TABLE applications DROP COLUMN IF EXISTS overall_status;
```

Also change the column in the `CREATE TABLE` block near the top of the file, replacing the `overall_status` declaration:

```sql
  triage_status TEXT
    CHECK (triage_status IN ('clean', 'review', 'discrepancy')),
```

- [ ] **Step 7: Update the data layer**

In `src/lib/db.ts`: change the type import from `OverallStatus` to `TriageStatus`, then in `toApplicationRecord`:

```ts
    triageStatus: row.triage_status,
```

and in `updateApplicationResult`:

```ts
export async function updateApplicationResult(
  id: string,
  update: {
    status: ApplicationStatus;
    triageStatus?: TriageStatus | null;
    fields?: FieldResult[] | null;
    errorMessage?: string | null;
  }
): Promise<void> {
  const db = getSql();
  await db`
    UPDATE applications
    SET status = ${update.status},
        triage_status = ${update.triageStatus ?? null},
        fields_json = ${update.fields ? JSON.stringify(update.fields) : null},
        error_message = ${update.errorMessage ?? null},
        updated_at = now()
    WHERE id = ${id}
  `;
}
```

- [ ] **Step 8: Update every remaining reference**

Run `npx tsc --noEmit` and fix each error it names. The known set:

- `src/lib/verify.ts` — `return { triageStatus: determineTriageStatus(fields), fields };` and the renamed import.
- `src/lib/processQueue.ts` — `triageStatus: outcome.triageStatus` in the `updateApplicationResult` call.
- `src/app/api/applications/route.ts` — same rename in its `updateApplicationResult` call and in the local `application = { ...application, status: "done", triageStatus: outcome.triageStatus, fields: outcome.fields }`.
- `src/components/ResultsCard.tsx` — prop `triageStatus: TriageStatus`, `const overall = TRIAGE_STATUS_META[triageStatus];`.
- `src/components/ApplicationQueue.tsx` — `TRIAGE_STATUS_META[application.triageStatus]`, `meta.shortLabel` in place of the `.replace(/ —.*/, "")` regex, the `needs_review`/`approved` filter tests now comparing against `"clean"`, and the `ResultsCard` call site. (Task 8 deletes this file, but it has to compile here so this task's build stays green — and its `StatusBadge` carries over into the replacement.)
- `src/components/AddSingleApplication.tsx` and `src/components/ImportApplications.tsx` — the `ResultsCard` prop.

- [ ] **Step 9: Run the migration against the live database**

Run: `npm run db:migrate`
Expected: the runner prints each statement as applied, with no error. Re-run it once more and confirm it's still clean — the file must stay idempotent.

- [ ] **Step 10: Verify**

Run: `npm test && npx tsc --noEmit && npx eslint src && npm run build`
Expected: all pass, no output from tsc or eslint.

- [ ] **Step 11: Commit**

```bash
git add -A src db
git commit -m "rename the automated verdict to a triage signal"
```

---

### Task 4: Persist the agent's decision

Two axes now exist in the schema: what the AI thought, and what a person ruled.

**Files:**
- Modify: `db/schema.sql`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/db.ts`
- Modify: `src/lib/statusMeta.ts`
- Test: none — this task is schema plus a thin query wrapper, both exercised end-to-end in Task 5. Do not add a test that mocks the Neon driver; it would assert the mock, not the SQL.

**Interfaces:**
- Consumes: Task 3's `TriageStatus`.
- Produces:
  - `export type ReviewDecision = "approved" | "rejected";`
  - `ApplicationRecord.decision: ReviewDecision | null`, `.decisionReason: string | null`, `.decidedAt: string | null`, `.decisionFlaggedFields: string[] | null`
  - `recordDecision(id: string, decision: ReviewDecision, reason: string | null): Promise<ApplicationRecord | null>`
  - `DECISION_META: Record<ReviewDecision, { glyph, label, className }>`

- [ ] **Step 1: Add the decision columns**

Append to `db/schema.sql`:

```sql
-- A human reviewer's decision. Separate from triage_status on purpose: the
-- automated check never decides anything, and every application is signed off
-- by a person.
--
-- decision_flagged_fields snapshots which fields the automated check had
-- flagged at the moment of sign-off. An agent approving an application the
-- check flagged is the most useful signal this system produces — it is the
-- calibration data for the matching thresholds, which are currently
-- reasonable defaults rather than anything tuned against real adjudications.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS decision TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS decision_reason TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS decision_flagged_fields JSONB;

-- The review queue's tabs split on this, so it is the one new access path.
CREATE INDEX IF NOT EXISTS applications_decision_idx ON applications (decision);
```

Add the same four columns to the `CREATE TABLE` block so a fresh database gets the `CHECK`, placed after `error_message`:

```sql
  decision TEXT
    CHECK (decision IN ('approved', 'rejected')),
  decision_reason TEXT,
  decided_at TIMESTAMPTZ,
  decision_flagged_fields JSONB,
```

- [ ] **Step 2: Add the type**

In `src/lib/types.ts`, after `TriageStatus`:

```ts
/** A person's sign-off. Only ever set by an agent, never by the automated check. */
export type ReviewDecision = "approved" | "rejected";
```

and extend `ApplicationRecord`, after `errorMessage`:

```ts
  decision: ReviewDecision | null;
  decisionReason: string | null;
  decidedAt: string | null;
  /** Which fields the automated check had flagged when the agent signed off. */
  decisionFlaggedFields: string[] | null;
```

- [ ] **Step 3: Map the new columns**

In `src/lib/db.ts`, add to `toApplicationRecord` after `errorMessage`:

```ts
    decision: row.decision,
    decisionReason: row.decision_reason,
    decidedAt: row.decided_at,
    decisionFlaggedFields: row.decision_flagged_fields,
```

- [ ] **Step 4: Add the write**

Append to `src/lib/db.ts`:

```ts
/**
 * Records an agent's sign-off. The flagged-field snapshot is computed here
 * from the row's own stored results rather than taken from the client, so it
 * reflects what the agent was actually shown and can't be spoofed by a
 * caller. Returns null if no such application exists.
 */
export async function recordDecision(
  id: string,
  decision: ReviewDecision,
  reason: string | null
): Promise<ApplicationRecord | null> {
  const db = getSql();
  const rows = await db`
    UPDATE applications
    SET decision = ${decision},
        decision_reason = ${reason},
        decided_at = now(),
        decision_flagged_fields = COALESCE(
          (
            SELECT jsonb_agg(field_entry->>'field')
            FROM jsonb_array_elements(fields_json) AS field_entry
            WHERE field_entry->>'status' <> 'match'
          ),
          '[]'::jsonb
        ),
        updated_at = now()
    WHERE id = ${id}
    RETURNING *
  `;
  return rows[0] ? toApplicationRecord(rows[0]) : null;
}
```

Add `ReviewDecision` to the type import at the top of the file.

- [ ] **Step 5: Add the decision metadata**

Append to `src/lib/statusMeta.ts`:

```ts
export const DECISION_META: Record<ReviewDecision, { glyph: string; label: string; className: string }> = {
  approved: { glyph: "✓", label: "Approved", className: "text-verified bg-verified-bg border-verified-border" },
  rejected: { glyph: "✕", label: "Rejected", className: "text-reject bg-reject-bg border-reject-border" },
};
```

and add `ReviewDecision` to its type import.

- [ ] **Step 6: Apply the migration**

Run: `npm run db:migrate`
Expected: clean. Run it a second time and confirm it is still clean.

- [ ] **Step 7: Verify the column shape landed**

Run:

```bash
node --env-file-if-exists=.env.local -e "const{neon}=require('@neondatabase/serverless');neon(process.env.DATABASE_URL)\`SELECT column_name FROM information_schema.columns WHERE table_name='applications' ORDER BY column_name\`.then(r=>console.log(r.map(x=>x.column_name).join('\n')))"
```

Expected: the list includes `decided_at`, `decision`, `decision_flagged_fields`, `decision_reason`, `triage_status`, and does **not** include `overall_status`.

- [ ] **Step 8: Verify**

Run: `npm test && npx tsc --noEmit && npx eslint src`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add db/schema.sql src/lib/types.ts src/lib/db.ts src/lib/statusMeta.ts
git commit -m "store the reviewing agent's decision alongside the triage signal"
```

---

### Task 5: The decision endpoint

**Files:**
- Create: `src/app/api/applications/[id]/decision/route.ts`

**Interfaces:**
- Consumes: `recordDecision`, `getApplication` from `src/lib/db.ts`; `ReviewDecision` from `src/lib/types.ts`.
- Produces: `POST /api/applications/:id/decision` taking `{ decision: "approved" | "rejected", reason?: string }` and returning `{ application: ApplicationRecord }`.

- [ ] **Step 1: Write the route**

Note the params shape: this codebase is on Next.js 16, where `context.params` is a **Promise** — see the sibling route at `src/app/api/applications/[id]/route.ts`.

```ts
import { NextResponse } from "next/server";
import { getApplication, recordDecision } from "@/lib/db";
import type { ReviewDecision } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Records an agent's sign-off on an application.
 *
 * A rejection must carry a reason: a compliance decision without a recorded
 * basis is not useful to anyone downstream, and the reviewer is the only one
 * who knows it. An approval doesn't, because the common case is "everything
 * matched" and forcing a note there would just train people to type "ok".
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const decision = payload.decision;
  if (decision !== "approved" && decision !== "rejected") {
    return NextResponse.json({ error: 'Decision must be either "approved" or "rejected".' }, { status: 400 });
  }

  const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
  if (decision === "rejected" && !reason) {
    return NextResponse.json({ error: "A rejection needs a reason." }, { status: 400 });
  }

  const existing = await getApplication(id);
  if (!existing) {
    return NextResponse.json({ error: "Application not found." }, { status: 404 });
  }
  if (existing.status !== "done") {
    // Deciding on a row that hasn't been checked yet would record a sign-off
    // against results that don't exist, and the flagged-field snapshot would
    // be empty for the wrong reason.
    return NextResponse.json(
      { error: "This application hasn't finished its automated check yet." },
      { status: 409 }
    );
  }

  const application = await recordDecision(id, decision as ReviewDecision, reason || null);
  if (!application) {
    return NextResponse.json({ error: "Application not found." }, { status: 404 });
  }
  return NextResponse.json({ application });
}
```

- [ ] **Step 2: Verify it compiles and the route registers**

Run: `npx tsc --noEmit && npx eslint src && npm run build`
Expected: the build's route table lists `ƒ /api/applications/[id]/decision`.

- [ ] **Step 3: Exercise it against the running app**

Start the dev server (`npm run dev`), then, using the id of any application already in the queue (get one from `curl -s http://localhost:3000/api/applications`):

```bash
curl -s -X POST http://localhost:3000/api/applications/<ID>/decision \
  -H 'Content-Type: application/json' -d '{"decision":"rejected"}'
```

Expected: `{"error":"A rejection needs a reason."}` with status 400.

```bash
curl -s -X POST http://localhost:3000/api/applications/<ID>/decision \
  -H 'Content-Type: application/json' -d '{"decision":"approved"}'
```

Expected: `{"application":{...}}` where `decision` is `"approved"`, `decidedAt` is a timestamp, and `decisionFlaggedFields` is an array (empty if the triage was clean).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/applications
git commit -m "add an endpoint for recording a review decision"
```

---

### Task 6: Serve label photos to the browser

The Blob store is private, so `image.url` is not fetchable from a browser — the modal cannot simply put it in an `<img src>`. Nothing in the UI displays images today, so this route is new and is a hard prerequisite for Task 7.

**Files:**
- Create: `src/app/api/applications/[id]/images/[index]/route.ts`

**Interfaces:**
- Consumes: `getApplication` from `src/lib/db.ts`, `downloadLabelImage` from `src/lib/blob.ts`.
- Produces: `GET /api/applications/:id/images/:index` returning the image bytes. Task 7 builds `src` values as `/api/applications/${application.id}/images/${i}`.

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { downloadLabelImage } from "@/lib/blob";
import { getApplication } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Streams one of an application's label photos to the browser.
 *
 * Needed because the Blob store is private: the stored URL isn't fetchable
 * from a page, so reads go through the SDK authenticated with the store
 * token. Indexing by position in the application's own image list — rather
 * than taking a Blob URL as a parameter — keeps this from becoming an open
 * proxy for arbitrary URLs.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string; index: string }> }) {
  const { id, index } = await context.params;

  const application = await getApplication(id);
  if (!application) {
    return NextResponse.json({ error: "Application not found." }, { status: 404 });
  }

  const position = Number(index);
  if (!Number.isInteger(position) || position < 0 || position >= application.images.length) {
    return NextResponse.json({ error: "No such image for this application." }, { status: 404 });
  }

  const image = application.images[position];
  try {
    const bytes = await downloadLabelImage(image.url);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": image.contentType,
        // Immutable: an application's photos never change after upload, and
        // the reviewer will open the same ones repeatedly while working.
        "Cache-Control": "private, max-age=3600, immutable",
        "Content-Disposition": `inline; filename="${encodeURIComponent(image.filename)}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "The stored label photo could not be read." }, { status: 502 });
  }
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npx eslint src && npm run build`
Expected: the route table lists `ƒ /api/applications/[id]/images/[index]`.

- [ ] **Step 3: Exercise it in a browser**

With `npm run dev` running, open `http://localhost:3000/api/applications/<ID>/images/0` for an application that has photos.
Expected: the label photo renders. Then open `.../images/99`.
Expected: a 404 JSON body, not a crash.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/applications
git commit -m "serve private label photos through an authenticated route"
```

---

### Task 7: The review modal

The assessment's description of the job — *"pulls up an application, looks at the label artwork, and checks that what's on the label matches what's in the application"* — is one screen holding all three things. This is that screen.

Built on the native `<dialog>` element: focus trapping, `Esc` to close, and the backdrop come from the browser, which matters more than usual given the accessibility bar this UI is built to.

**Files:**
- Create: `src/components/ReviewModal.tsx`

**Interfaces:**
- Consumes: `ApplicationRecord`, `ReviewDecision` from `src/lib/types.ts`; `FIELD_STATUS_META`, `TRIAGE_STATUS_META` from `src/lib/statusMeta.ts`; `POST /api/applications/:id/decision`; `GET /api/applications/:id/images/:index`.
- Produces:

```ts
interface ReviewModalProps {
  application: ApplicationRecord;
  onClose: () => void;
  onDecided: (updated: ApplicationRecord) => void;
}
export function ReviewModal(props: ReviewModalProps): React.JSX.Element
```

**Note on testing:** this project has no React test harness, and adding one (jsdom + Testing Library + config) is not justified by a two-day prototype that has no other component tests. This task is verified by type-check, lint, build, and the scripted browser check in Step 6. State that limitation rather than implying component coverage exists.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { DECISION_META, FIELD_STATUS_META, TRIAGE_STATUS_META } from "@/lib/statusMeta";
import type { ApplicationRecord, FieldResult, ReviewDecision } from "@/lib/types";

interface ReviewModalProps {
  application: ApplicationRecord;
  onClose: () => void;
  onDecided: (updated: ApplicationRecord) => void;
}

/** Pre-fills the rejection box from what the automated check flagged, so the
 *  common rejection is a confirmation rather than an essay. */
function suggestedReason(fields: FieldResult[]): string {
  const flagged = fields.filter((f) => f.status !== "match");
  if (flagged.length === 0) return "";
  return flagged.map((f) => `${f.label}: ${f.detail ?? "does not match the application."}`).join("\n");
}

export function ReviewModal({ application, onClose, onDecided }: ReviewModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fields = application.fields ?? [];
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState(() => suggestedReason(fields));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // showModal() can't be set declaratively — it's the call that establishes
  // the top layer, the backdrop, and the focus trap.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  async function decide(decision: ReviewDecision) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/applications/${application.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reason: decision === "rejected" ? reason : undefined }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not record this decision.");
      onDecided(data.application as ApplicationRecord);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record this decision.");
      setBusy(false);
    }
  }

  const triage = application.triageStatus ? TRIAGE_STATUS_META[application.triageStatus] : null;
  const decided = application.decision ? DECISION_META[application.decision] : null;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="m-auto w-[min(72rem,92vw)] max-w-none bg-paper p-0 text-ink backdrop:bg-ink/50"
    >
      <div className="flex items-start justify-between gap-4 border-b border-border p-5">
        <div>
          <h2 className="text-xl font-bold text-ink">{application.brandName}</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Added {new Date(application.createdAt).toLocaleString()}
          </p>
        </div>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          className="border border-border px-3 py-1.5 text-sm font-medium text-ink-muted hover:text-ink"
        >
          Close
        </button>
      </div>

      {triage && (
        <p className={`flex items-center gap-3 border-l-4 p-4 font-semibold ${triage.className} ${triage.edgeClassName}`}>
          <span aria-hidden className="text-xl leading-none">{triage.glyph}</span>
          {triage.label}
        </p>
      )}

      <div className="grid max-h-[65vh] gap-6 overflow-y-auto p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section>
          <h3 className="mb-3 text-sm font-semibold text-ink">Label photos</h3>
          <div className="space-y-3">
            {application.images.map((image, index) => (
              <figure key={image.url} className="border border-border bg-paper-muted">
                {/* Deliberately a plain <img>: these are private, authenticated
                    bytes served by our own route, which next/image's optimizer
                    can't fetch. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/applications/${application.id}/images/${index}`}
                  alt={`Label photo ${index + 1} of ${application.images.length} for ${application.brandName}`}
                  className="max-h-96 w-full bg-paper object-contain"
                />
                <figcaption className="truncate border-t border-border px-3 py-1.5 text-xs text-ink-muted">
                  {image.filename}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-sm font-semibold text-ink">Application fields</h3>
          <div className="border border-border">
            {fields.map((field, index) => {
              const meta = FIELD_STATUS_META[field.status];
              return (
                <div
                  key={field.field}
                  className={`border-l-4 bg-paper p-4 ${meta.edgeClassName} ${index > 0 ? "border-t border-border" : ""}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-ink">{field.label}</span>
                    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded border px-2 py-0.5 text-sm font-medium ${meta.className}`}>
                      <span aria-hidden>{meta.glyph}</span>
                      {meta.label}
                    </span>
                  </div>
                  <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-ink-muted">Submitted on application</dt>
                      <dd className="wrap-break-word text-ink">{field.expected ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-muted">Found on label</dt>
                      <dd className="wrap-break-word text-ink">{field.extracted ?? "—"}</dd>
                    </div>
                  </dl>
                  {field.detail && <p className="mt-2 text-sm text-ink-muted">{field.detail}</p>}
                  {field.secondOpinion && (
                    <p className="mt-2 border-t border-border pt-2 text-sm text-ink-muted">
                      Second check:{" "}
                      {field.secondOpinion.agreesWithFirstPass
                        ? "a second model read the label the same way."
                        : `a second model read this as "${field.secondOpinion.extracted ?? "nothing"}" instead — confirm manually.`}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <div className="border-t border-border bg-paper-muted p-5">
        {error && <p className="mb-3 border-l-4 border-reject bg-reject-bg p-3 text-sm text-reject">{error}</p>}

        {decided ? (
          <div className="space-y-2">
            <p className={`inline-flex items-center gap-2 rounded border px-3 py-1 font-semibold ${decided.className}`}>
              <span aria-hidden>{decided.glyph}</span>
              {decided.label} on {new Date(application.decidedAt!).toLocaleString()}
            </p>
            {application.decisionReason && (
              <p className="whitespace-pre-line text-sm text-ink-muted">{application.decisionReason}</p>
            )}
          </div>
        ) : rejecting ? (
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-ink">Why is this being rejected?</span>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={4}
                className="w-full border border-border bg-paper p-2 text-ink"
              />
            </label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => decide("rejected")}
                disabled={busy || !reason.trim()}
                className="bg-reject px-4 py-2 font-semibold text-paper disabled:opacity-50"
              >
                {busy ? "Recording…" : "Reject application"}
              </button>
              <button
                type="button"
                onClick={() => setRejecting(false)}
                disabled={busy}
                className="border border-border px-4 py-2 font-medium text-ink-muted hover:text-ink"
              >
                Back
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => decide("approved")}
              disabled={busy}
              className="bg-verified px-4 py-2 font-semibold text-paper disabled:opacity-50"
            >
              {busy ? "Recording…" : "Approve application"}
            </button>
            <button
              type="button"
              onClick={() => setRejecting(true)}
              disabled={busy}
              className="border border-reject px-4 py-2 font-semibold text-reject hover:bg-reject-bg disabled:opacity-50"
            >
              Reject application
            </button>
          </div>
        )}
      </div>
    </dialog>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit && npx eslint src`
Expected: clean. If eslint objects to `react-hooks/set-state-in-effect`, do not silence it globally — the `showModal()` effect sets no state, so any such error means the code drifted from the version above.

- [ ] **Step 3: Commit**

```bash
git add src/components/ReviewModal.tsx
git commit -m "add the review modal with photos, field markers, and sign-off"
```

The modal is wired into the queue in Task 8; a browser check follows there, since nothing renders it yet.

---

### Task 8: The triaged review queue

Replaces `ApplicationQueue.tsx`. Five tabs in workflow order, a search box, a sort control, and counts on each tab.

**Files:**
- Create: `src/components/ReviewQueue.tsx`
- Delete: `src/components/ApplicationQueue.tsx`
- Modify: `src/components/VerifierApp.tsx`

**Interfaces:**
- Consumes: `ReviewModal` from Task 7; `ApplicationRecord` from `src/lib/types.ts`; `TRIAGE_STATUS_META`, `DECISION_META` from `src/lib/statusMeta.ts`; `GET /api/applications`.
- Produces: `export function ReviewQueue(): React.JSX.Element`.

- [ ] **Step 1: Write the component**

Carry over from `ApplicationQueue.tsx` unchanged: the fetch/poll effects with their existing `eslint-disable-next-line react-hooks/set-state-in-effect` comment, the `loadError` / `applications === null` early returns (everything below assumes `applications` is a non-null array, including the tab counts), `handleDelete`, `handleCancelBatch`, `handleResume`, the batch-progress banner, the `LIFECYCLE_META` map, and the `StatusBadge` component — which by this point reads `TRIAGE_STATUS_META[...]` and `meta.shortLabel` after Task 3. What follows is what is new or different.

The import block at the top of the new file:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { ErrorCard } from "./ResultsCard";
import { ReviewModal } from "./ReviewModal";
import { DECISION_META, TRIAGE_STATUS_META } from "@/lib/statusMeta";
import type { ApplicationRecord, ApplicationStatus } from "@/lib/types";
```

Note `Fragment` and `ResultsCard` are no longer imported — the modal replaced the inline expansion.

```tsx
type TabKey = "clean" | "attention" | "approved" | "rejected" | "not_ready";

const TABS: { key: TabKey; label: string; test: (a: ApplicationRecord) => boolean }[] = [
  // Order follows the working day: the easy pile, then the judgement calls,
  // then what's already been signed off. "Not ready" is last but present —
  // an application that vanishes from every tab never gets adjudicated, and
  // in a compliance queue that's a defect, not a tidy default.
  { key: "clean", label: "Clean matches", test: (a) => a.status === "done" && !a.decision && a.triageStatus === "clean" },
  { key: "attention", label: "Needs attention", test: (a) => a.status === "done" && !a.decision && a.triageStatus !== "clean" },
  { key: "approved", label: "Approved", test: (a) => a.decision === "approved" },
  { key: "rejected", label: "Rejected", test: (a) => a.decision === "rejected" },
  { key: "not_ready", label: "Not ready", test: (a) => a.status !== "done" },
];

type SortKey = "newest" | "oldest" | "brand";

const SORTS: { key: SortKey; label: string; compare: (a: ApplicationRecord, b: ApplicationRecord) => number }[] = [
  { key: "newest", label: "Newest first", compare: (a, b) => b.createdAt.localeCompare(a.createdAt) },
  { key: "oldest", label: "Oldest first", compare: (a, b) => a.createdAt.localeCompare(b.createdAt) },
  { key: "brand", label: "Brand name (A-Z)", compare: (a, b) => a.brandName.localeCompare(b.brandName) },
];
```

State added alongside the existing state:

```tsx
  const [tab, setTab] = useState<TabKey>("clean");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [openId, setOpenId] = useState<string | null>(null);
```

Filtering and sorting, replacing the old single `filtered` line. Search runs client-side because `listApplications` already caps the result at 200 rows — a server round trip per keystroke would be slower and no more correct:

```tsx
  const query = search.trim().toLowerCase();
  const visible = applications
    .filter(TABS.find((t) => t.key === tab)!.test)
    .filter(
      (a) =>
        !query ||
        a.brandName.toLowerCase().includes(query) ||
        a.classType.toLowerCase().includes(query)
    )
    .sort(SORTS.find((s) => s.key === sort)!.compare);
```

The tab bar, with counts so the shape of the queue is legible without clicking:

```tsx
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const count = applications.filter(t.test).length;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-current={tab === t.key ? "page" : undefined}
              className={`border px-3 py-1.5 text-sm font-medium ${
                tab === t.key ? "border-seal bg-seal text-paper" : "border-border text-ink-muted hover:text-ink"
              }`}
            >
              {t.label}
              <span className={tab === t.key ? "ml-2 text-paper/80" : "ml-2 text-ink-muted/70"}>{count}</span>
            </button>
          );
        })}
      </div>
```

The search and sort row:

```tsx
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex-1">
          <span className="sr-only">Search by brand or class/type</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by brand or class/type"
            className="w-full border border-border bg-paper px-3 py-2 text-ink placeholder:text-ink-muted"
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-sm text-ink-muted">Sort</span>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            className="border border-border bg-paper px-3 py-2 text-ink"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
```

The table rows become one click-to-open action instead of the old expand/collapse. Replace the `View`/`Hide` button with:

```tsx
                        <button
                          type="button"
                          onClick={() => setOpenId(application.id)}
                          disabled={application.status !== "done"}
                          className="mr-3 font-medium text-seal hover:underline disabled:cursor-not-allowed disabled:text-ink-muted disabled:no-underline"
                        >
                          Review
                        </button>
```

Delete the `isOpen` / `expandedId` state and the entire inline expanded `<tr>` that rendered `ResultsCard` — the modal replaces it.

Render the modal after the table:

```tsx
      {openId && (
        <ReviewModal
          application={applications.find((a) => a.id === openId)!}
          onClose={() => setOpenId(null)}
          onDecided={(updated) => {
            setApplications((prev) => (prev ?? []).map((a) => (a.id === updated.id ? updated : a)));
            setOpenId(null);
          }}
        />
      )}
```

Empty states, which should say what to do rather than just reporting emptiness:

```tsx
      {visible.length === 0 && (
        <p className="border border-dashed border-border p-8 text-center text-ink-muted">
          {applications.length === 0
            ? "No applications yet. Add one from the Add applications tab to get started."
            : query
              ? `Nothing in ${TABS.find((t) => t.key === tab)!.label.toLowerCase()} matches "${search}".`
              : `Nothing in ${TABS.find((t) => t.key === tab)!.label.toLowerCase()} right now.`}
        </p>
      )}
```

Add a decision column so the Approved and Rejected tabs are informative at a glance. The new header cell, placed after the `Status` one:

```tsx
                <th className="px-4 py-2 text-left font-medium text-ink-muted">Decision</th>
```

and the matching body cell, in the same position within each row:

```tsx
                      <td className="px-4 py-3 whitespace-nowrap">
                        {application.decision ? (
                          <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-sm ${DECISION_META[application.decision].className}`}>
                            <span aria-hidden>{DECISION_META[application.decision].glyph}</span>
                            {DECISION_META[application.decision].label}
                          </span>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </td>
```

The table has six columns once this lands, so update the `colSpan` on any full-width row that survived the edit.

- [ ] **Step 2: Point the app shell at the new component**

In `src/components/VerifierApp.tsx`, swap the import and usage of `ApplicationQueue` for `ReviewQueue`, and rename the tab label and blurb so review reads as the product rather than one of two equal halves:

```tsx
        <TabButton active={view === "queue"} onClick={() => setView("queue")}>
          Review applications
        </TabButton>
```

```tsx
          <p className="mt-2 max-w-prose text-ink-muted">
            Check each application against its label photos, then approve or reject it.
          </p>
```

- [ ] **Step 3: Delete the old queue**

```bash
git rm src/components/ApplicationQueue.tsx
```

- [ ] **Step 4: Verify it compiles and builds**

Run: `npx tsc --noEmit && npx eslint src && npm test && npm run build`
Expected: all clean. If `ResultsCard` is now unused by any component, leave it in place — `AddSingleApplication` and `ImportApplications` still render it for their immediate post-submit result.

- [ ] **Step 5: Verify in a browser**

With `npm run dev` running, at `http://localhost:3000`:

1. All five tabs render with counts, and the counts sum to the total number of applications.
2. Typing a brand fragment in the search box narrows the list; clearing it restores.
3. Changing sort to "Brand name (A-Z)" reorders the rows.
4. Clicking **Review** on a finished application opens the modal with photos on one side and fields on the other.
5. `Esc` closes the modal.
6. **Approve application** closes the modal, and the row moves to the Approved tab with its decision shown.
7. Reopening that application shows the recorded decision and timestamp instead of the buttons.
8. **Reject application** on another one pre-fills the reason from the flagged fields; clearing the box disables the confirm button.
9. Clicking **Review** on a row in "Not ready" is disabled, not broken.
10. Toggle dark mode and confirm the modal, tabs, and search field all follow the theme.

- [ ] **Step 6: Commit**

```bash
git add -A src/components
git commit -m "replace the flat queue with triage tabs, search, sort, and sign-off"
```

---

### Task 9: Documentation

The README is a graded deliverable (*"Brief documentation of approach, tools used, assumptions made"*), and this restructuring changes the app's central claim about itself.

**Files:**
- Modify: `README.md`
- Modify: `public/sample-batch-template.csv` (only if its `filenames` column has rows exceeding three images)

- [ ] **Step 1: Rewrite the "How It Works" opening**

Replace the existing `**Review queue** (the default view) — ...` paragraph with:

```markdown
**Reviewing applications** (the default view) — every application that's been added, sorted into five tabs by where it is in the workflow:

- **Clean matches** — the automated check found nothing wrong. Still needs an agent's sign-off.
- **Needs attention** — one or more fields didn't match, or couldn't be confirmed from the photos supplied.
- **Approved** / **Rejected** — already signed off, with who decided what and why.
- **Not ready** — still processing, cancelled, or failed. These stay visible on purpose: an application that disappears from every tab never gets adjudicated.

Search by brand or class/type and sort the list, then open an application to review it. The review window puts the label photos and the application fields side by side — each field marked as matching, needing a closer look, disagreeing, or not visible in the photos — and ends in **Approve** or **Reject**. A rejection records why; an approval doesn't need one.

The automated check never decides anything. It sorts the queue and marks the fields worth looking at; a person signs off on every application.
```

- [ ] **Step 2: Add the two-axis explanation to "Approach & Technical Choices"**

Add a bullet:

```markdown
- **The automated check produces a triage signal, not a verdict.** Its three values (`clean` / `review` / `discrepancy`) are deliberately different words from an agent's `approved` / `rejected`, because at one point they weren't — the schema used "approved" for both, which would have put two unrelated meanings of the same word in front of an audience the interviews benchmark against someone who *"just learned to video call her grandkids last year."* Every application is signed off by a person; the AI's job is to decide what to look at first, which is the actual complaint in the interviews (*"they're drowning in routine stuff"*).
```

- [ ] **Step 3: Replace the "Why at least two photos" section**

That rule is gone. Replace it with the evidence-gap explanation:

```markdown
**Photos and what can be checked from them:** one to three per application. One is enough when it's a composite showing front and back together, which is why the minimum isn't two — image *count* never told us what was actually photographed. Instead the extraction call reports whether any image shows a face other than the front, and the warning check branches on it: no warning found with a back view present is a violation; no warning found with no back view present is "not shown", which asks for a better photo instead of reporting a defect. The interviews name that as a real step (*"if an agent can't read the label they just reject it and ask for a better image"*), and conflating it with a violation is what produced the false "missing warning" reports.
```

- [ ] **Step 4: Add the calibration note to "Assumptions & Trade-offs"**

Amend the existing thresholds bullet:

```markdown
- **Matching thresholds (fuzzy-match similarity, ABV tolerance, net-contents tolerance) are reasonable defaults, not calibrated against real TTB adjudication data.** Each decision now stores which fields the automated check had flagged at the moment of sign-off, so an agent approving something the check flagged is recorded as exactly that — which is the data you'd tune these thresholds against once real reviewers have used it.
```

- [ ] **Step 5: Add the untested-UI limitation**

```markdown
- **No component tests.** The comparison, matching, escalation, and spreadsheet logic have unit tests; the React components don't. Adding a browser test harness wasn't a good use of a two-day budget relative to covering the logic that decides outcomes, so the UI was verified by hand against the checklist in the implementation plan.
```

- [ ] **Step 6: Check the sample template still validates**

Run: `grep -c ';.*;.*;' public/sample-batch-template.csv`
Expected: `0`. A non-zero count means some row lists four or more filenames and would now be rejected — trim those rows to three.

- [ ] **Step 7: Verify the whole project one final time**

Run: `npm test && npx tsc --noEmit && npx eslint src && npm run build`
Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add README.md public/sample-batch-template.csv
git commit -m "document the review workflow and the evidence-gap rule"
```

---

## Deployment note

Before the deployed app works, these must exist in the Vercel project's environment variables (they currently exist only in local `.env.local`): `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, `ANTHROPIC_KEY`, `CRON_SECRET`. The schema changes in Tasks 3 and 4 must also be applied to the deployed database — `npm run db:migrate` runs against whatever `DATABASE_URL` points at, so run it once with the production value.

The README's **Live Demo** section is still a `TODO` placeholder and needs the deployed URL before submission.
