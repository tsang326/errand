/**
 * Channel3 returns a product's colours as swatches measured off its photo:
 * `[{hex: '#1f2a44', percentage: 0.62}, …]`. A model asked "is it navy?" cannot
 * be trusted to read a hex code, so the swatches are named here, by rule, before
 * the ranking step sees them. The names are coarse on purpose: a shopper says
 * "navy" or "olive", not "#1f2a44", and a coarse name that is right beats a fine
 * one that is guessed.
 */

export type Swatch = { hex: string; percentage: number };

/** Swatches covering less than this share of the photo are noise (stitching, a logo). */
const MIN_SHARE = 0.1;

const hexToRgb = (hex: string): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** HSL with h in degrees, s and l in 0..1. */
const toHsl = ([r, g, b]: [number, number, number]): [number, number, number] => {
  const [rf, gf, bf] = [r / 255, g / 255, b / 255];
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rf) h = ((gf - bf) / d) % 6;
  else if (max === gf) h = (bf - rf) / d + 2;
  else h = (rf - gf) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
};

/** One plain colour word for a hex value, or null if it cannot be read. */
export function colourName(hex: string): string | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [h, s, l] = toHsl(rgb);

  if (l < 0.1) return 'black';
  if (l > 0.94) return 'white';
  if (s < 0.12) {
    if (l < 0.25) return 'black';
    if (l < 0.42) return 'charcoal';
    if (l < 0.7) return 'grey';
    if (l < 0.88) return 'light grey';
    return 'white';
  }

  // Warm hues that are dark or muted read as brown, beige or tan, not orange.
  if (h >= 10 && h < 50) {
    if (l < 0.42) return 'brown';
    if (s < 0.45 && l > 0.65) return 'beige';
    if (s < 0.45) return 'tan';
  }

  if (h < 12 || h >= 345) return l < 0.3 ? 'burgundy' : l > 0.75 ? 'pink' : 'red';
  if (h < 40) return 'orange';
  if (h < 66) return l < 0.35 ? 'olive' : s > 0.6 && l < 0.55 ? 'gold' : 'yellow';
  if (h < 100 && (l < 0.4 || s < 0.3)) return 'olive';
  if (h < 160) return l < 0.25 ? 'dark green' : 'green';
  if (h < 195) return 'teal';
  if (h < 255) return l < 0.3 ? 'navy' : l > 0.72 ? 'light blue' : 'blue';
  if (h < 290) return 'purple';
  return l > 0.7 ? 'pink' : 'magenta';
}

/**
 * Names for the swatches worth naming, largest first, each with its share of
 * the photo: `['navy 62%', 'white 21%']`. Swatches that name the same colour are
 * merged, so two shades of navy count as one.
 */
export function nameSwatches(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const share = new Map<string, number>();
  for (const s of raw) {
    if (typeof s !== 'object' || s === null) continue;
    const { hex, percentage } = s as Partial<Swatch>;
    if (typeof hex !== 'string' || typeof percentage !== 'number') continue;
    const name = colourName(hex);
    if (!name) continue;
    share.set(name, (share.get(name) ?? 0) + percentage);
  }
  return [...share.entries()]
    .filter(([, p]) => p >= MIN_SHARE)
    .sort((a, b) => b[1] - a[1])
    .map(([n, p]) => `${n} ${Math.round(p * 100)}%`);
}
