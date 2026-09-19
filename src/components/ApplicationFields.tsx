"use client";

import type { ChangeEvent } from "react";
import { ALL_CLASS_TYPES } from "@/lib/classTypes";
import { BEVERAGE_TYPE_LABELS, inferBeverageType, isBeverageType, type BeverageType } from "@/lib/beverageType";

/** The four application fields, as strings - ABV stays text until submit so a
 *  half-typed number doesn't fight the input. */
export interface ApplicationFormState {
  brandName: string;
  classType: string;
  abvPercent: string;
  netContents: string;
  /** "" means let the class/type designation decide. See beverageType.ts. */
  beverageType: string;
}

export const emptyApplicationForm: ApplicationFormState = {
  brandName: "",
  classType: "",
  abvPercent: "",
  netContents: "",
  beverageType: "",
};

/** The value to send to the API: an explicit choice, or null to let the
 *  class/type designation decide. */
export function formBeverageType(form: ApplicationFormState): BeverageType | null {
  return isBeverageType(form.beverageType) ? form.beverageType : null;
}

export function isApplicationFormFilled(form: ApplicationFormState): boolean {
  return Boolean(form.brandName.trim() && form.classType.trim() && form.abvPercent.trim() && form.netContents.trim());
}

/**
 * Shared by the single-add form and each row of a guided import, so the
 * class/type list and the field labels can't drift apart between the two
 * places an application is typed in.
 *
 * The class/type input is a native `<input list>` + `<datalist>` rather than a
 * custom combobox: the browser handles keyboard and screen-reader behaviour,
 * and free text still goes through, because src/lib/classTypes.ts is a
 * representative subset of the TTB standards of identity rather than the
 * exhaustive list. An agent shouldn't be blocked by a designation we didn't
 * enumerate.
 */
export function ApplicationFields({
  form,
  onChange,
  idPrefix,
  disabled = false,
}: {
  form: ApplicationFormState;
  onChange: (next: ApplicationFormState) => void;
  /** Distinguishes labels/ids when more than one of these is ever on a page. */
  idPrefix: string;
  disabled?: boolean;
}) {
  function update(key: keyof ApplicationFormState) {
    return (event: ChangeEvent<HTMLInputElement>) => onChange({ ...form, [key]: event.target.value });
  }

  const inputClass =
    "w-full border border-border bg-paper px-3 py-2 text-ink placeholder:text-ink-muted/60 focus:border-seal focus:outline-none disabled:opacity-60";

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-ink">Brand name</span>
        <input
          type="text"
          value={form.brandName}
          onChange={update("brandName")}
          placeholder="OLD TOM DISTILLERY"
          required
          disabled={disabled}
          className={inputClass}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-ink">Class/type designation</span>
        <input
          type="text"
          list={`${idPrefix}-class-types`}
          value={form.classType}
          onChange={update("classType")}
          placeholder="Start typing, e.g. Bourbon"
          required
          disabled={disabled}
          className={inputClass}
        />
        <datalist id={`${idPrefix}-class-types`}>
          {ALL_CLASS_TYPES.map((designation) => (
            <option key={designation} value={designation} />
          ))}
        </datalist>
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-ink">Alcohol content (% ABV)</span>
        <input
          type="number"
          step="0.1"
          value={form.abvPercent}
          onChange={update("abvPercent")}
          placeholder="45"
          required
          disabled={disabled}
          className={inputClass}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-ink">Net contents</span>
        <input
          type="text"
          value={form.netContents}
          onChange={update("netContents")}
          placeholder="750 mL"
          required
          disabled={disabled}
          className={inputClass}
        />
      </label>

      {/* Which TTB part applies, because the mandatory label information
          differs between them. Usually inferable from the class/type
          designation, so this only needs answering for a designation we
          don't recognise; the label under the field says what was worked
          out, so an agent can see whether it needs correcting. */}
      <label className="block sm:col-span-2">
        <span className="mb-1 block text-sm font-medium text-ink">Beverage type</span>
        <select
          value={form.beverageType}
          onChange={(event) => onChange({ ...form, beverageType: event.target.value })}
          disabled={disabled}
          className={inputClass}
        >
          <option value="">Work it out from the class/type</option>
          <option value="spirits">{BEVERAGE_TYPE_LABELS.spirits}</option>
          <option value="wine">{BEVERAGE_TYPE_LABELS.wine}</option>
          <option value="malt">{BEVERAGE_TYPE_LABELS.malt}</option>
        </select>
        {!form.beverageType && (
          <span className="mt-1 block text-sm text-ink-muted">{describeInferred(form.classType)}</span>
        )}
      </label>
    </div>
  );
}

function describeInferred(classType: string): string {
  if (!classType.trim()) return "Enter a class/type and this will be worked out for you.";
  const inferred = inferBeverageType(classType);
  return inferred
    ? `Read as ${BEVERAGE_TYPE_LABELS[inferred].toLowerCase()} from the class/type.`
    : "This class/type isn't one we recognise. Choose a type so the right rules are applied, or the alcohol content check will be skipped.";
}
