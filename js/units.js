// Display formatting for amounts. Recipes store canonical g / ml / each / pkg;
// people shop and cook in US kitchen units, so convert back at display time.

const FRACTIONS = [[0, ''], [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [1 / 2, '½'], [2 / 3, '⅔'], [3 / 4, '¾'], [1, '']];

/** 1.333 -> "1⅓", 0.25 -> "¼", 2 -> "2". */
export function fraction(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  let whole = Math.floor(n);
  const rest = n - whole;
  let best = FRACTIONS[0];
  for (const f of FRACTIONS) if (Math.abs(rest - f[0]) < Math.abs(rest - best[0])) best = f;
  if (best[0] === 1) whole += 1;
  if (whole === 0 && !best[1]) return '⅛'; // never round a real amount down to nothing
  return whole === 0 ? best[1] : `${whole}${best[1]}`;
}

const plural = (n, word) => (n > 1 && !/s$/.test(word) ? `${word}s` : word);

const ML = { tsp: 4.929, tbsp: 14.787, cup: 236.588, quart: 946.353 };
const G = { oz: 28.3495, lb: 453.592 };

/** Format a canonical amount ({ value, unit, package, packageOz, countUnit }) for a shopping list. */
export function formatAmount(a) {
  const v = a.value;
  switch (a.unit) {
    case 'ml':
      if (v < ML.tbsp * 0.9) return `${fraction(v / ML.tsp)} tsp`;
      if (v < ML.cup / 4) return `${fraction(v / ML.tbsp)} tbsp`;
      if (v < ML.quart * 2) return `${fraction(v / ML.cup)} ${plural(v / ML.cup, 'cup')}`;
      return `${fraction(v / ML.quart)} quarts`;
    case 'g':
      if (v >= G.lb * 0.75) return `${fraction(v / G.lb)} lb`;
      return `${fraction(v / G.oz)} oz`;
    case 'pkg': {
      const kind = a.package || 'pkg';
      const size = a.packageOz ? ` (${+a.packageOz.toFixed(1)} oz)` : '';
      return `${fraction(v)} ${plural(v, kind)}${size}`;
    }
    case 'each':
      return a.countUnit ? `${fraction(v)} ${plural(v, a.countUnit)}` : fraction(v);
    default:
      return `${+v.toFixed(2)} ${a.unit}`;
  }
}

/** Scaled quantity text for a recipe line: (2, 3) -> "2–3". */
export function formatQuantity(q, qMax) {
  if (q == null) return '';
  return qMax != null && qMax !== q ? `${fraction(q)}–${fraction(qMax)}` : fraction(q);
}
