import { CLASS_TYPE_GROUPS } from "./classTypes";
import { normalizeForComparison } from "./textMatch";

/**
 * Which body of TTB regulation a product falls under: 27 CFR part 5 for
 * distilled spirits, part 4 for wine, part 7 for malt beverages. It matters
 * because the mandatory label information genuinely differs between them, most
 * sharply for alcohol content.
 */
export type BeverageType = "spirits" | "wine" | "malt";

export const BEVERAGE_TYPE_LABELS: Record<BeverageType, string> = {
  spirits: "Distilled spirits",
  wine: "Wine",
  malt: "Malt beverage",
};

const GROUP_TO_TYPE: Record<string, BeverageType> = {
  "Distilled spirits": "spirits",
  Wine: "wine",
  "Malt beverages": "malt",
};

const DESIGNATION_TO_TYPE = new Map<string, BeverageType>(
  CLASS_TYPE_GROUPS.flatMap((group) =>
    group.designations.map((designation) => [normalizeForComparison(designation), GROUP_TO_TYPE[group.group]] as const)
  )
);

export function isBeverageType(value: unknown): value is BeverageType {
  return value === "spirits" || value === "wine" || value === "malt";
}

/**
 * Works out the beverage type from the class/type designation, so an existing
 * application or spreadsheet does not have to declare it.
 *
 * Returns null rather than guessing when the designation is not one we know.
 * A wrong guess here silently changes which rules a label is judged against,
 * which is worse than admitting we do not know: see abvRequirement, which
 * treats an unknown type as "we cannot say this is required".
 */
export function inferBeverageType(classType: string): BeverageType | null {
  const normalized = normalizeForComparison(classType);
  if (!normalized) return null;

  const exact = DESIGNATION_TO_TYPE.get(normalized);
  if (exact) return exact;

  // Fall back to the longest known designation contained in the text, so
  // "Kentucky Straight Bourbon Whiskey, Bottled in Bond" still resolves, and a
  // designation that contains a shorter one ("Malt Whiskey" vs "Whiskey")
  // resolves to the more specific match.
  let best: { length: number; type: BeverageType } | null = null;
  for (const [designation, type] of DESIGNATION_TO_TYPE) {
    if (normalized.includes(designation) && (!best || designation.length > best.length)) {
      best = { length: designation.length, type };
    }
  }
  return best?.type ?? null;
}

export function resolveBeverageType(classType: string, declared?: BeverageType | null): BeverageType | null {
  return declared ?? inferBeverageType(classType);
}

export type AbvRequirement = "required" | "optional";

export interface AbvRule {
  requirement: AbvRequirement;
  /** Why, in words an agent can act on, when the statement may be absent. */
  reason?: string;
}

/**
 * Whether TTB requires an alcohol content statement on the label itself.
 *
 * This exists because treating it as always-required manufactured false
 * findings: an ordinary American beer is not required to state its ABV at all,
 * so flagging its absence reported a regulation that does not exist.
 *
 *   Distilled spirits - always required (27 CFR 5.65).
 *   Wine             - required (27 CFR 4.34), except that between 7% and 14%
 *                      a numerical statement may be replaced by the class
 *                      designation "table wine" or "light wine".
 *   Malt beverages   - optional, unless the product contains alcohol from
 *                      added nonbeverage flavors or ingredients other than
 *                      hops extract (27 CFR 7.63(a)(3)). Whether it does is
 *                      not visible on the label, so that case is surfaced for
 *                      a human rather than decided here.
 *
 * TTB has proposed making alcohol content mandatory for products that
 * currently need not carry it. If that is finalised this function is the one
 * place that changes.
 */
export function abvRequirement(
  type: BeverageType | null,
  classType: string,
  applicationAbv: number
): AbvRule {
  if (type === "spirits") return { requirement: "required" };

  if (type === "wine") {
    const designation = normalizeForComparison(classType);
    const substituteDesignation = designation.includes("table wine") || designation.includes("light wine");
    if (applicationAbv >= 7 && applicationAbv <= 14 && substituteDesignation) {
      return {
        requirement: "optional",
        reason:
          'Wine of 7% to 14% alcohol by volume may carry the class designation "table wine" or "light wine" instead of a numerical alcohol content statement (27 CFR 4.34).',
      };
    }
    return { requirement: "required" };
  }

  if (type === "malt") {
    return {
      requirement: "optional",
      reason:
        "A malt beverage is not required to state its alcohol content unless it contains alcohol from added flavors or other nonbeverage ingredients (27 CFR 7.63). Confirm whether that applies to this product.",
    };
  }

  // Type unknown, because the class/type designation is not one we recognise.
  // Not treated as required: asserting a violation on a rule we could not
  // determine is the failure this function was written to prevent.
  return {
    requirement: "optional",
    reason:
      "The beverage type could not be determined from the class/type designation, so whether an alcohol content statement is required could not be established. Confirm manually.",
  };
}
