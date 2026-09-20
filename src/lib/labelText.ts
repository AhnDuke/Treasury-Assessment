import { normalizeForComparison } from "./textMatch";

/**
 * Normalising the two fields where a label and an application say the same
 * thing in visibly different words.
 *
 * Both were producing false mismatches on correct applications: a label must
 * write "PRODUCED BY THE SMIRNOFF CO., NEW YORK, N.Y." while the person filling
 * in the form types "Smirnoff Co, New York, NY", and a label saying "MADE IN
 * AMERICA" was reported as disagreeing with an application saying "USA". The
 * information is the same; only the formatting differs, and flagging that
 * wastes the reviewer's attention on something that is not a defect.
 */

const PRODUCTION_VERB =
  /\b(?:bottled|packed|produced|manufactured|imported|brewed|canned|distilled|vinted|blended|prepared|made)\b/i;

/**
 * Removes the lead-in a label puts before a name and address. The regulations
 * require one of several phrases, and an application almost never repeats it.
 *
 * Takes the opening clause up to the first "by", non-greedy so an address
 * containing another "by" cannot swallow the name, and only when that clause
 * reads like a production or import statement, so a company whose name starts
 * with an unrelated "by" is left alone.
 */
export function stripNameAddressLeadIn(value: string): string {
  const text = value.trim();
  const match = /^(.*?\bby)\s+/i.exec(text);
  if (match && PRODUCTION_VERB.test(match[1])) {
    return text.slice(match[0].length).trim();
  }
  return text;
}

/** Corporate forms that carry no distinguishing information. */
const COMPANY_SUFFIXES: Array<[RegExp, string]> = [
  [/\bcompany\b/g, "co"],
  [/\bincorporated\b/g, "inc"],
  [/\bcorporation\b/g, "corp"],
  [/\blimited\b/g, "ltd"],
  [/\blimited liability company\b/g, "llc"],
];

/**
 * Joins runs of single letters back into one token, so an initialism survives
 * punctuation being stripped. "N.Y." normalises to "n y", which would
 * otherwise not equal the "ny" an application typed.
 */
export function collapseInitialisms(value: string): string {
  return value.replace(/\b(?:[a-z]\s+){1,}[a-z]\b/g, (run) => run.replace(/\s+/g, ""));
}

/**
 * Reduces a name and address to what actually identifies it: no lead-in, no
 * leading article, corporate forms spelled one way, initialisms joined up.
 */
export function normalizeNameAddress(value: string): string {
  let text = normalizeForComparison(stripNameAddressLeadIn(value));
  text = text.replace(/^the\s+/, "");
  for (const [pattern, replacement] of COMPANY_SUFFIXES) {
    text = text.replace(pattern, replacement);
  }
  return collapseInitialisms(text).replace(/\s+/g, " ").trim();
}

/** Phrases a label wraps a country in. "Product of Mexico" names Mexico. */
const ORIGIN_LEAD_IN =
  /^(?:product\s+of|produce\s+of|made\s+in|manufactured\s+in|produced\s+in|distilled\s+in|brewed\s+in|bottled\s+in|packed\s+in|grown\s+in|imported\s+from|origin|country\s+of\s+origin)\s*:?\s*/i;

/**
 * Names that mean the same country. Only the cases that actually collide in
 * this domain, kept deliberately short: a wrong guess here would silently
 * accept a country the label does not state, which is worse than asking a
 * reviewer to confirm an unusual spelling.
 */
const COUNTRY_ALIASES: Record<string, string> = {
  usa: "united states",
  us: "united states",
  "u s a": "united states",
  america: "united states",
  "united states of america": "united states",
  "united states": "united states",
  uk: "united kingdom",
  "u k": "united kingdom",
  "great britain": "united kingdom",
  britain: "united kingdom",
  england: "united kingdom",
  scotland: "scotland",
  holland: "netherlands",
  "the netherlands": "netherlands",
};

/**
 * Reduces a country of origin to a comparable form: the wrapper phrase
 * removed, then a known alias resolved to one spelling.
 */
export function canonicalCountry(value: string): string {
  const withoutLeadIn = value.trim().replace(ORIGIN_LEAD_IN, "");
  // "Product of the USA" leaves a leading article behind, which would stop the
  // alias lookup matching.
  const normalized = normalizeForComparison(withoutLeadIn).replace(/^the\s+/, "");
  if (!normalized) return "";
  const collapsed = collapseInitialisms(normalized);
  return COUNTRY_ALIASES[normalized] ?? COUNTRY_ALIASES[collapsed] ?? collapsed;
}
