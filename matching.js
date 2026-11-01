/* Pairwise merchant eligibility. Never use this client helper as a security boundary;
 * the matching RPC independently enforces the corresponding rules in PostgreSQL. */
export const CATEGORIES = [
  ['beverage','Beverage Only'], ['food','Food Only'], ['food_beverage','Food & Beverage'],
  ['fashion','Fashion & Apparel'], ['general','General Merchandise & Anik-aniks'],
  ['footwear','Footwear, Bags & Leather Goods'], ['jewelry','Jewelry & Fashion Accessories'],
  ['beauty','Beauty, Skincare & Cosmetics'], ['fragrance','Perfumes & Home Fragrances'],
  ['crafts','Arts, Crafts, Crochet & Stationery'], ['tech','Gadgets & Tech Accessories'],
  ['pets','Pet Products'], ['other','Other Specialty Products']
];
export const CATEGORY_LABELS = Object.fromEntries(CATEGORIES);
const autoPairs = [
  ['beverage','food'], ['fashion','footwear'], ['fashion','jewelry'],
  ['fashion','beauty'], ['footwear','jewelry'], ['beauty','jewelry'],
  ['beauty','fragrance'], ['general','crafts']
];
export const AUTO_PAIRS = autoPairs;
const key = (a,b) => [a,b].sort().join('|');
const allowed = new Set(autoPairs.map(([a,b]) => key(a,b)));
export const normalizedTags = list => [...new Set((Array.isArray(list)?list:[]).map(x=>String(x).toLowerCase().trim()).filter(Boolean))];
export function checkCompatibility(a,b) {
  if (!a || !b) return {state:'blocked', reason:'Missing merchant information'};
  if (a.user_id && b.user_id && a.user_id === b.user_id) return {state:'blocked',reason:'Cannot match with yourself'};
  if (a.category === b.category) return {state:'blocked', reason:'Same primary category'};
  const tagsA = normalizedTags(a.product_tags), tagsB = new Set(normalizedTags(b.product_tags));
  if (tagsA.some(t=>tagsB.has(t))) return {state:'blocked',reason:'Overlapping declared products'};
  if ((Number(a.space_units)||1)+(Number(b.space_units)||1)>2) return {state:'blocked',reason:'Combined setup exceeds shared-stall space'};
  if (allowed.has(key(a.category,b.category))) return {state:'compatible',reason:'Complementary categories, subject to admin product review'};
  return {state:'review',reason:'Different categories; organizer review required'};
}
