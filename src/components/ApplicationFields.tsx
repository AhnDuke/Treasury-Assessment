"use client";

import type { ChangeEvent } from "react";
import { ALL_CLASS_TYPES } from "@/lib/classTypes";

/** The four application fields, as strings - ABV stays text until submit so a
 *  half-typed number doesn't fight the input. */
export interface ApplicationFormState {
  brandName: string;
  classType: string;
  abvPercent: string;
  netContents: string;
}

export const emptyApplicationForm: ApplicationFormState = {
  brandName: "",
  classType: "",
  abvPercent: "",
  netContents: "",
};

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
    </div>
  );
}
