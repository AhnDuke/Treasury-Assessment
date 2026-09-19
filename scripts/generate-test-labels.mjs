// Generates an import test fixture: synthetic label images plus the
// spreadsheet that claims to describe them.
//
// The sheet keeps a `filenames` column even though the app no longer resolves
// filenames — photos are attached per row in the UI now. It survives as a hint
// the import surfaces while you work each row, so whoever is testing knows
// which of the 79 images belong to the row in front of them.
//
//   node scripts/generate-test-labels.mjs [outputDir]     (default: test-batch/)
//
// Every row is built from two independent halves:
//
//   * a LABEL DEFECT, baked into the rendered image (the warning is omitted,
//     its header is title-case, its wording is altered, or the back label was
//     never photographed), and
//   * an APPLICATION PERTURBATION, applied to the spreadsheet row (a typo in
//     the brand, an ABV outside tolerance, a volume in different units).
//
// Keeping them separate is the point: the app compares what the application
// CLAIMS against what the label SHOWS, so a fixture has to be able to vary
// each side on its own. Each row therefore gets its own image files rather
// than sharing a product's images, because the defect lives in the pixels.
//
// The expected outcome of every row is written to EXPECTED.md so a run can be
// checked against intent rather than against whatever it happened to produce.

import sharp from "sharp";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..");
const outDir = path.resolve(process.argv[2] ?? path.join(repoRoot, "test-batch"));
const imageDir = path.join(outDir, "images");

const WIDTH = 500;
const HEIGHT = 700;
const PAPER = "#f4f1e8";
const INK = "#14110d";
const EDGE = "#241f18";

// Characters per line in the warning block. Arial at 11px averages ~5.4px per
// character, and the block spans WIDTH minus a 35px gutter each side, so this
// is deliberately conservative — an overflowing line is silently clipped at
// the label edge, which corrupts the very text the fixture is checking.
const WARNING_CHARS_PER_LINE = 72;

// Read the statutory text out of the app rather than restating it here, so the
// fixture can never drift from what the comparison actually checks against.
const warningSource = await readFile(path.join(repoRoot, "src/lib/warningStatement.ts"), "utf8");
const warningMatch = warningSource.match(/"((?:[^"\\]|\\.)*GOVERNMENT WARNING:(?:[^"\\]|\\.)*)"/);
if (!warningMatch) {
  throw new Error("Could not read STATUTORY_WARNING_TEXT from src/lib/warningStatement.ts");
}
const STATUTORY_WARNING = warningMatch[1];

// Plausible-looking wording that is not the statutory text. Used for the rows
// that should be caught as a genuine wording violation rather than as a
// transcription artifact, so it differs well beyond the 97% similarity floor.
const ALTERED_WARNING =
  "GOVERNMENT WARNING: Drinking alcoholic beverages may be hazardous to your health and is not recommended during pregnancy. Please enjoy our products responsibly and never operate a vehicle after drinking.";

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Greedy wrap. SVG has no auto-wrapping, so lines are measured here. */
function wrap(text, maxChars) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && (line + " " + word).length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? line + " " + word : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function frameSvg(inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${EDGE}"/>
  <rect x="8" y="8" width="${WIDTH - 16}" height="${HEIGHT - 16}" fill="${PAPER}"/>
  ${inner}
</svg>`;
}

function frontSvg(product) {
  const brandLines = wrap(product.brand, 14);
  const brandSize = brandLines.length > 1 ? 40 : 46;
  let y = brandLines.length > 1 ? 120 : 140;
  const brandTspans = brandLines
    .map((line, i) => `<text x="250" y="${y + i * (brandSize + 8)}" font-family="Georgia, 'Times New Roman', serif" font-size="${brandSize}" font-weight="bold" letter-spacing="1" text-anchor="middle" fill="${INK}">${escapeXml(line)}</text>`)
    .join("\n  ");
  y = y + brandLines.length * (brandSize + 8) + 20;

  const classLines = wrap(product.classType, 34);
  const classTspans = classLines
    .map((line, i) => `<text x="250" y="${y + i * 30}" font-family="Georgia, serif" font-size="21" font-style="italic" text-anchor="middle" fill="${INK}">${escapeXml(line)}</text>`)
    .join("\n  ");
  y = y + classLines.length * 30 + 60;

  return frameSvg(`${brandTspans}
  ${classTspans}
  <line x1="170" y1="${y - 34}" x2="330" y2="${y - 34}" stroke="${INK}" stroke-width="1" opacity="0.35"/>
  <text x="250" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="17" text-anchor="middle" fill="${INK}">${escapeXml(product.abvText)}</text>
  <text x="250" y="${y + 34}" font-family="Arial, Helvetica, sans-serif" font-size="17" text-anchor="middle" fill="${INK}">${escapeXml(product.netContents)}</text>
  <text x="250" y="${HEIGHT - 60}" font-family="Georgia, serif" font-size="13" font-style="italic" text-anchor="middle" fill="${INK}" opacity="0.6">${escapeXml(product.origin)}</text>`);
}

function backSvg(product, warningMode) {
  const descLines = wrap(product.description, 58);
  const descTspans = descLines
    .map((line, i) => `<text x="250" y="${150 + i * 22}" font-family="Arial, Helvetica, sans-serif" font-size="13" text-anchor="middle" fill="${INK}">${escapeXml(line)}</text>`)
    .join("\n  ");

  let warningBlock = "";
  if (warningMode !== "omitted") {
    let text = warningMode === "altered" ? ALTERED_WARNING : STATUTORY_WARNING;
    if (warningMode === "titlecase") {
      text = text.replace("GOVERNMENT WARNING:", "Government Warning:");
    }
    const header = text.slice(0, text.indexOf(":") + 1);

    // Wrap the header and body together, then peel the header back off the
    // first line to render it bold. Wrapping the body alone and prepending the
    // header afterwards makes the first line wider than every other one, which
    // overflowed the label edge and truncated the statutory text — producing
    // exactly the false "wording does not match" result this fixture exists to
    // test against.
    const lines = wrap(text, WARNING_CHARS_PER_LINE);
    const firstRest = (lines[0] ?? "").slice(header.length).trim();
    const rest = lines.slice(1);

    warningBlock = `<line x1="35" y1="${HEIGHT - 128}" x2="${WIDTH - 35}" y2="${HEIGHT - 128}" stroke="${INK}" stroke-width="1" opacity="0.4"/>
  <text x="35" y="${HEIGHT - 104}" font-family="Arial, Helvetica, sans-serif" font-size="11" fill="${INK}"><tspan font-weight="bold">${escapeXml(header)}</tspan> ${escapeXml(firstRest)}</text>
  ${rest.map((line, i) => `<text x="35" y="${HEIGHT - 104 + (i + 1) * 15}" font-family="Arial, Helvetica, sans-serif" font-size="11" fill="${INK}">${escapeXml(line)}</text>`).join("\n  ")}`;
  }

  return frameSvg(`<text x="250" y="100" font-family="Georgia, serif" font-size="19" letter-spacing="3" text-anchor="middle" fill="${INK}">${escapeXml(product.brand)}</text>
  ${descTspans}
  <text x="250" y="${150 + descLines.length * 22 + 34}" font-family="Arial, Helvetica, sans-serif" font-size="17" text-anchor="middle" fill="${INK}">${escapeXml(product.netContents)}  |  ${escapeXml(product.abvText)}</text>
  <text x="250" y="${150 + descLines.length * 22 + 70}" font-family="Arial, Helvetica, sans-serif" font-size="12" text-anchor="middle" fill="${INK}" opacity="0.7">${escapeXml(product.bottler)}</text>
  ${warningBlock}`);
}

function neckSvg(product) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="220">
  <rect width="${WIDTH}" height="220" fill="${EDGE}"/>
  <rect x="8" y="8" width="${WIDTH - 16}" height="204" fill="${PAPER}"/>
  <text x="250" y="90" font-family="Georgia, serif" font-size="24" letter-spacing="4" text-anchor="middle" fill="${INK}">${escapeXml(product.brand)}</text>
  <text x="250" y="140" font-family="Georgia, serif" font-size="15" font-style="italic" text-anchor="middle" fill="${INK}">${escapeXml(product.origin)}</text>
</svg>`;
}

// --- Products -------------------------------------------------------------
// Class/type designations are taken from src/lib/classTypes.ts so they match
// the searchable dropdown. No value contains a comma: the CSV is consumed by a
// hand-rolled parser and this fixture should exercise the app, not the parser.

const PRODUCTS = [
  { slug: "old-tom", brand: "OLD TOM DISTILLERY", classType: "Kentucky Straight Bourbon Whiskey", abv: 45, netContents: "750 mL", origin: "Bardstown Kentucky", bottler: "Bottled by Old Tom Distillery Bardstown KY", description: "Distilled and bottled in small batches. Aged in new charred oak barrels." },
  { slug: "stones-throw", brand: "STONE'S THROW", classType: "India Pale Ale", abv: 6.2, netContents: "355 mL", origin: "Asheville North Carolina", bottler: "Brewed and canned by Stone's Throw Brewing Asheville NC", description: "Dry hopped with Citra and Mosaic. Unfiltered and brewed in small batches." },
  { slug: "riverbend", brand: "RIVERBEND CELLARS", classType: "Cabernet Sauvignon", abv: 14.5, netContents: "750 mL", origin: "Napa Valley California", bottler: "Produced and bottled by Riverbend Cellars Napa CA", description: "Estate grown and barrel aged eighteen months in French oak." },
  { slug: "copper-kettle", brand: "COPPER KETTLE", classType: "London Dry Gin", abv: 44, netContents: "750 mL", origin: "Portland Oregon", bottler: "Distilled and bottled by Copper Kettle Spirits Portland OR", description: "Botanicals of juniper coriander and angelica root in a copper pot still." },
  { slug: "harvest-moon", brand: "HARVEST MOON VINEYARD", classType: "Chardonnay", abv: 13.2, netContents: "750 mL", origin: "Sonoma County California", bottler: "Produced and bottled by Harvest Moon Vineyard Sonoma CA", description: "Fermented in stainless steel with partial malolactic conversion." },
  { slug: "iron-gate", brand: "IRON GATE BREWING", classType: "Stout", abv: 7.4, netContents: "473 mL", origin: "Milwaukee Wisconsin", bottler: "Brewed and canned by Iron Gate Brewing Milwaukee WI", description: "Roasted barley and chocolate malt. Pours opaque with a tan head." },
  { slug: "silver-birch", brand: "SILVER BIRCH", classType: "Vodka", abv: 40, netContents: "1 L", origin: "Burlington Vermont", bottler: "Distilled and bottled by Silver Birch Distilling Burlington VT", description: "Column distilled from winter wheat and filtered through birch charcoal." },
  { slug: "cascade-ridge", brand: "CASCADE RIDGE", classType: "Pinot Noir", abv: 13.8, netContents: "750 mL", origin: "Willamette Valley Oregon", bottler: "Produced and bottled by Cascade Ridge Winery Dundee OR", description: "Hand harvested from volcanic soils and aged fourteen months in oak." },
  { slug: "blackwater", brand: "BLACKWATER RESERVE", classType: "Straight Rye Whiskey", abv: 50.5, netContents: "750 mL", origin: "Lawrenceburg Indiana", bottler: "Distilled and bottled by Blackwater Reserve Lawrenceburg IN", description: "Ninety five percent rye mash bill aged six years in charred oak." },
  { slug: "golden-fields", brand: "GOLDEN FIELDS", classType: "Pilsner", abv: 4.8, netContents: "355 mL", origin: "Fort Collins Colorado", bottler: "Brewed and bottled by Golden Fields Brewery Fort Collins CO", description: "Czech style pilsner lagered for six weeks with Saaz hops." },
  { slug: "casa-verde", brand: "CASA VERDE", classType: "Tequila", abv: 40, netContents: "750 mL", origin: "Jalisco Mexico", bottler: "Produced in Mexico and imported by Casa Verde Imports Austin TX", description: "Made from one hundred percent blue weber agave and rested in oak." },
  { slug: "north-shore", brand: "NORTH SHORE CELLARS", classType: "Riesling", abv: 11.5, netContents: "750 mL", origin: "Finger Lakes New York", bottler: "Produced and bottled by North Shore Cellars Geneva NY", description: "Off dry with bright acidity from cool climate slate soils." },
  { slug: "saltmarsh", brand: "SALTMARSH", classType: "Rum", abv: 43, netContents: "700 mL", origin: "Charleston South Carolina", bottler: "Distilled and bottled by Saltmarsh Rum Works Charleston SC", description: "Pot distilled from blackstrap molasses and aged four years." },
  { slug: "wild-ferment", brand: "WILD FERMENT", classType: "Sour Ale", abv: 5.6, netContents: "375 mL", origin: "Hood River Oregon", bottler: "Brewed and bottled by Wild Ferment Brewing Hood River OR", description: "Spontaneously fermented and aged in oak foeders for two years." },
  { slug: "monteleone", brand: "MONTELEONE", classType: "Sparkling Wine", abv: 12, netContents: "750 mL", origin: "Sonoma County California", bottler: "Produced and bottled by Monteleone Sparkling Sonoma CA", description: "Traditional method with thirty months on the lees before disgorging." },
  { slug: "kestrel-hill", brand: "KESTREL HILL", classType: "Scotch Whisky", abv: 46, netContents: "700 mL", origin: "Speyside Scotland", bottler: "Distilled in Scotland and imported by Kestrel Hill Imports Boston MA", description: "Single malt matured in sherry casks and bottled without chill filtering." },
];

const bySlug = Object.fromEntries(PRODUCTS.map((p) => [p.slug, p]));

// --- Perturbations --------------------------------------------------------
// Each returns the application data as SUBMITTED, which may differ from what
// the label shows. `expect` records the intended per-field outcome.

const PERTURBATIONS = {
  none: {
    note: "Application matches the label exactly.",
    apply: (p) => ({}),
    expect: {},
  },
  brandCase: {
    note: "Brand differs only in casing. Should be a full match, not a flag — this is Dave Morrison's 'STONE'S THROW' vs 'Stone's Throw' complaint.",
    apply: (p) => ({ brand_name: titleCase(p.brand) }),
    expect: { brandName: "match" },
  },
  brandTypo: {
    note: "One letter wrong in the brand. Near-miss, so needs review rather than a hard fail.",
    apply: (p) => ({ brand_name: swapLetter(p.brand) }),
    expect: { brandName: "review" },
  },
  brandWrong: {
    note: "Entirely different brand on the application than on the label.",
    apply: () => ({ brand_name: "SUMMIT CROSSING RESERVE" }),
    expect: { brandName: "mismatch" },
  },
  abvSlight: {
    note: "ABV differs by 0.2 points, inside the 0.3 tolerance. Should match.",
    apply: (p) => ({ abv_percent: round1(p.abv + 0.2) }),
    expect: { abvPercent: "match" },
  },
  abvWrong: {
    note: "ABV off by several points. Outside tolerance, so a discrepancy.",
    apply: (p) => ({ abv_percent: round1(p.abv + 5.5) }),
    expect: { abvPercent: "mismatch" },
  },
  volumeUnit: {
    note: "Same volume expressed in different units (750 mL vs 0.75 L). Should match after unit conversion.",
    apply: (p) => ({ net_contents: altUnit(p.netContents) }),
    expect: { netContents: "match" },
  },
  volumeWrong: {
    note: "Net contents disagree with the label.",
    apply: () => ({ net_contents: "500 mL" }),
    expect: { netContents: "mismatch" },
  },
  classTypo: {
    note: "Class/type misspelled. Near-miss, so needs review.",
    apply: (p) => ({ class_type: swapLetter(p.classType) }),
    expect: { classType: "review" },
  },
  classWrong: {
    note: "Class/type designation on the application is not what the label declares.",
    apply: () => ({ class_type: "Blended Whiskey" }),
    expect: { classType: "mismatch" },
  },
};

function titleCase(value) {
  return value
    .toLowerCase()
    .split(" ")
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function swapLetter(value) {
  // Change one interior letter of the longest word, which produces a
  // high-similarity near miss rather than a different string.
  const words = value.split(" ");
  let idx = 0;
  for (let i = 1; i < words.length; i++) if (words[i].length > words[idx].length) idx = i;
  const w = words[idx];
  const at = Math.floor(w.length / 2);
  const ch = w[at].toLowerCase();
  const swap = ch === "a" ? "e" : ch === "e" ? "a" : ch === "o" ? "u" : ch === "i" ? "e" : "a";
  words[idx] = w.slice(0, at) + (w[at] === w[at].toUpperCase() ? swap.toUpperCase() : swap) + w.slice(at + 1);
  return words.join(" ");
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function altUnit(netContents) {
  const m = netContents.match(/^([\d.]+)\s*(mL|L)$/i);
  if (!m) return netContents;
  const [, qty, unit] = m;
  return unit.toLowerCase() === "ml" ? `${Number(qty) / 1000} L` : `${Number(qty) * 1000} mL`;
}

// --- Rows -----------------------------------------------------------------
// warning: ok | titlecase | altered | omitted
// images:  front-back | front-only | front-back-neck

const ROWS = [
  // --- Clean matches: these should all land in the "Clean matches" tab ---
  { product: "old-tom", warning: "ok", images: "front-back", perturbation: "none" },
  { product: "riverbend", warning: "ok", images: "front-back", perturbation: "none" },
  { product: "copper-kettle", warning: "ok", images: "front-back", perturbation: "none" },
  { product: "golden-fields", warning: "ok", images: "front-back", perturbation: "none" },
  { product: "north-shore", warning: "ok", images: "front-back", perturbation: "none" },
  { product: "saltmarsh", warning: "ok", images: "front-back", perturbation: "none" },
  { product: "kestrel-hill", warning: "ok", images: "front-back-neck", perturbation: "none" },
  { product: "monteleone", warning: "ok", images: "front-back-neck", perturbation: "none" },
  { product: "stones-throw", warning: "ok", images: "front-back", perturbation: "brandCase" },
  { product: "harvest-moon", warning: "ok", images: "front-back", perturbation: "brandCase" },
  { product: "cascade-ridge", warning: "ok", images: "front-back", perturbation: "abvSlight" },
  { product: "iron-gate", warning: "ok", images: "front-back", perturbation: "abvSlight" },
  { product: "silver-birch", warning: "ok", images: "front-back", perturbation: "volumeUnit" },
  { product: "blackwater", warning: "ok", images: "front-back", perturbation: "volumeUnit" },

  // --- Near misses: should land in "Needs attention" as review, not failure ---
  { product: "casa-verde", warning: "ok", images: "front-back", perturbation: "brandTypo" },
  { product: "wild-ferment", warning: "ok", images: "front-back", perturbation: "brandTypo" },
  { product: "old-tom", warning: "ok", images: "front-back", perturbation: "classTypo" },
  { product: "north-shore", warning: "ok", images: "front-back", perturbation: "classTypo" },

  // --- Hard discrepancies ---
  { product: "riverbend", warning: "ok", images: "front-back", perturbation: "brandWrong" },
  { product: "golden-fields", warning: "ok", images: "front-back", perturbation: "brandWrong" },
  { product: "copper-kettle", warning: "ok", images: "front-back", perturbation: "abvWrong" },
  { product: "stones-throw", warning: "ok", images: "front-back", perturbation: "abvWrong" },
  { product: "harvest-moon", warning: "ok", images: "front-back", perturbation: "volumeWrong" },
  { product: "saltmarsh", warning: "ok", images: "front-back", perturbation: "volumeWrong" },
  { product: "cascade-ridge", warning: "ok", images: "front-back", perturbation: "classWrong" },
  { product: "kestrel-hill", warning: "ok", images: "front-back", perturbation: "classWrong" },

  // --- Warning statement defects, the thing the app exists to catch ---
  { product: "iron-gate", warning: "titlecase", images: "front-back", perturbation: "none" },
  { product: "monteleone", warning: "titlecase", images: "front-back", perturbation: "none" },
  { product: "silver-birch", warning: "altered", images: "front-back", perturbation: "none" },
  { product: "wild-ferment", warning: "altered", images: "front-back", perturbation: "none" },
  { product: "blackwater", warning: "omitted", images: "front-back", perturbation: "none" },
  { product: "casa-verde", warning: "omitted", images: "front-back", perturbation: "none" },

  // --- Evidence gaps: front only, so the warning cannot be judged at all ---
  { product: "old-tom", warning: "ok", images: "front-only", perturbation: "none" },
  { product: "riverbend", warning: "ok", images: "front-only", perturbation: "none" },
  { product: "golden-fields", warning: "ok", images: "front-only", perturbation: "none" },
  { product: "kestrel-hill", warning: "ok", images: "front-only", perturbation: "abvWrong" },

  // --- Compound cases: more than one thing wrong at once ---
  { product: "harvest-moon", warning: "omitted", images: "front-back", perturbation: "abvWrong" },
  { product: "saltmarsh", warning: "altered", images: "front-back", perturbation: "brandWrong" },
  { product: "north-shore", warning: "titlecase", images: "front-back", perturbation: "classTypo" },
  { product: "cascade-ridge", warning: "ok", images: "front-back-neck", perturbation: "volumeWrong" },
];

// --- Expected outcome -----------------------------------------------------

function warningExpectation(warning, images) {
  if (images === "front-only") return { status: "not_shown", why: "No back label supplied, so the warning cannot be judged. Reported as an evidence gap, not a violation." };
  if (warning === "omitted") return { status: "missing", why: "A back label was supplied and carries no warning at all. A genuine omission." };
  if (warning === "altered") return { status: "mismatch", why: "Wording departs from the statutory text well beyond a transcription artifact." };
  if (warning === "titlecase") return { status: "review", why: "Wording is correct but the header is title case rather than all caps — Jenny Park's rejection case." };
  return { status: "match", why: "" };
}

const RANK = { match: 0, review: 1, not_shown: 1, mismatch: 2, missing: 2 };

function triageOf(statuses) {
  const worst = Math.max(...statuses.map((s) => RANK[s] ?? 0));
  return worst === 0 ? "clean" : worst === 1 ? "review" : "discrepancy";
}

// --- Generate -------------------------------------------------------------

await rm(outDir, { recursive: true, force: true });
await mkdir(imageDir, { recursive: true });

const csvRows = [["filenames", "brand_name", "class_type", "abv_percent", "net_contents"]];
const expectedRows = [];
let imagesWritten = 0;

for (const [i, row] of ROWS.entries()) {
  const product = bySlug[row.product];
  if (!product) throw new Error(`Unknown product slug: ${row.product}`);
  const id = String(i + 1).padStart(2, "0");
  const stem = `${id}-${product.slug}`;
  const labelProduct = { ...product, abvText: `${product.abv}% Alc./Vol.` };

  const files = [];

  await sharp(Buffer.from(frontSvg(labelProduct))).png().toFile(path.join(imageDir, `${stem}-front.png`));
  files.push(`${stem}-front.png`);
  imagesWritten++;

  if (row.images !== "front-only") {
    await sharp(Buffer.from(backSvg(labelProduct, row.warning))).png().toFile(path.join(imageDir, `${stem}-back.png`));
    files.push(`${stem}-back.png`);
    imagesWritten++;
  }
  if (row.images === "front-back-neck") {
    await sharp(Buffer.from(neckSvg(labelProduct))).png().toFile(path.join(imageDir, `${stem}-neck.png`));
    files.push(`${stem}-neck.png`);
    imagesWritten++;
  }

  const perturbation = PERTURBATIONS[row.perturbation];
  const overrides = perturbation.apply(product);
  const submitted = {
    brand_name: overrides.brand_name ?? product.brand,
    class_type: overrides.class_type ?? product.classType,
    abv_percent: overrides.abv_percent ?? product.abv,
    net_contents: overrides.net_contents ?? product.netContents,
  };

  csvRows.push([files.join(";"), submitted.brand_name, submitted.class_type, String(submitted.abv_percent), submitted.net_contents]);

  const warn = warningExpectation(row.warning, row.images);
  const fieldStatuses = {
    brandName: perturbation.expect.brandName ?? "match",
    classType: perturbation.expect.classType ?? "match",
    abvPercent: perturbation.expect.abvPercent ?? "match",
    netContents: perturbation.expect.netContents ?? "match",
    warningStatement: warn.status,
  };

  expectedRows.push({
    id,
    stem,
    brand: product.brand,
    images: files.length,
    triage: triageOf(Object.values(fieldStatuses)),
    fields: fieldStatuses,
    notes: [perturbation.note, warn.why].filter(Boolean),
  });
}

// Every value is comma-free by construction, so a plain join is honest here
// rather than a quoting routine that is never exercised.
for (const row of csvRows) {
  for (const cell of row) {
    if (String(cell).includes(",")) throw new Error(`Comma in CSV value would need quoting: ${cell}`);
  }
}
await writeFile(path.join(outDir, "applications.csv"), csvRows.map((r) => r.join(",")).join("\n") + "\n", "utf8");

const counts = expectedRows.reduce((acc, r) => ({ ...acc, [r.triage]: (acc[r.triage] ?? 0) + 1 }), {});

const doc = `# Expected results

Generated by \`node scripts/generate-test-labels.mjs\`. ${ROWS.length} applications, ${imagesWritten} label images.

## How to use it

Go to **Add applications → Import** and choose \`applications.csv\`. The app reads the
sheet and then walks you through the rows one at a time.

For each row, the \`filenames\` column is shown as a reminder of which files belong to it —
attach those from \`images/\` and submit, or scrap the row. The app never resolves those
names itself, so the column is a convenience for whoever is testing rather than something
the import depends on.

Submitted rows are queued and checked in the background, so you can keep working through
the sheet without waiting for each one.

After processing finishes, the queue should hold roughly:

| Tab | Count |
|-----|-------|
| Clean matches | ${counts.clean ?? 0} |
| Needs attention | ${(counts.review ?? 0) + (counts.discrepancy ?? 0)} |

"Roughly" is the honest word: extraction is a vision model reading rendered
text, so an occasional field may land one step stricter or looser than the
table below. A row that disagrees with its expected outcome is worth opening —
that is the point of the fixture.

Field statuses: \`match\`, \`review\` (needs a closer look), \`mismatch\`,
\`missing\` (absent from a label we could see), \`not_shown\` (we were never
shown the side it would be on).

| # | Brand | Imgs | Expected triage | Brand | Class/Type | ABV | Net | Warning | Why |
|---|-------|------|-----------------|-------|------------|-----|-----|---------|-----|
${expectedRows
  .map(
    (r) =>
      `| ${r.id} | ${r.brand} | ${r.images} | **${r.triage}** | ${r.fields.brandName} | ${r.fields.classType} | ${r.fields.abvPercent} | ${r.fields.netContents} | ${r.fields.warningStatement} | ${r.notes.join(" ")} |`
  )
  .join("\n")}
`;

await writeFile(path.join(outDir, "EXPECTED.md"), doc, "utf8");

console.log(`Wrote ${ROWS.length} applications and ${imagesWritten} images to ${path.relative(repoRoot, outDir)}/`);
console.log(`  applications.csv   the import spreadsheet`);
console.log(`  images/            label photos referenced by the filenames column`);
console.log(`  EXPECTED.md        what each row should produce`);
console.log(`Expected triage: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join("  ")}`);
