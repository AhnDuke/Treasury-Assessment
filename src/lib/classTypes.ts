/**
 * Class/type designations drawn from TTB's standards of identity
 * (27 CFR Part 4 wine, Part 5 distilled spirits, Part 7 malt beverages).
 *
 * This is a REPRESENTATIVE SUBSET, not the exhaustive regulatory list — the
 * full set of classes and types (with all their sub-designations, age and
 * origin qualifiers) is far larger. The field accepts free text precisely
 * because of that: an agent shouldn't be blocked by an incomplete list.
 */
export const CLASS_TYPE_GROUPS: { group: string; designations: string[] }[] = [
  {
    group: "Distilled spirits",
    designations: [
      "Bourbon Whiskey",
      "Kentucky Straight Bourbon Whiskey",
      "Straight Bourbon Whiskey",
      "Rye Whiskey",
      "Straight Rye Whiskey",
      "Corn Whiskey",
      "Wheat Whiskey",
      "Malt Whiskey",
      "Blended Whiskey",
      "Scotch Whisky",
      "Irish Whiskey",
      "Canadian Whisky",
      "Tennessee Whiskey",
      "Vodka",
      "Gin",
      "London Dry Gin",
      "Rum",
      "Tequila",
      "Mezcal",
      "Brandy",
      "Cognac",
      "Armagnac",
      "Applejack",
      "Liqueur",
      "Cordial",
      "Neutral Spirits",
    ],
  },
  {
    group: "Wine",
    designations: [
      "Table Wine",
      "Red Table Wine",
      "White Table Wine",
      "Dessert Wine",
      "Sparkling Wine",
      "Champagne",
      "Carbonated Wine",
      "Cabernet Sauvignon",
      "Chardonnay",
      "Merlot",
      "Pinot Noir",
      "Pinot Grigio",
      "Sauvignon Blanc",
      "Riesling",
      "Zinfandel",
      "Syrah",
      "Malbec",
      "Rosé Wine",
      "Port",
      "Sherry",
      "Vermouth",
      "Fruit Wine",
      "Apple Wine",
      "Hard Cider",
    ],
  },
  {
    group: "Malt beverages",
    designations: [
      "Beer",
      "Ale",
      "Lager",
      "Pilsner",
      "India Pale Ale",
      "Pale Ale",
      "Stout",
      "Porter",
      "Wheat Beer",
      "Bock",
      "Malt Liquor",
      "Flavored Malt Beverage",
      "Non-Alcoholic Malt Beverage",
    ],
  },
];

export const ALL_CLASS_TYPES: string[] = CLASS_TYPE_GROUPS.flatMap((g) => g.designations);
