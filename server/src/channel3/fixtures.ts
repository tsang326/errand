import type { Product, SearchResult } from './types.js';

/**
 * Invented products for offline development. Nothing here came from Channel3
 * and no price is a real price: the names are deliberately generic so a
 * screenshot taken by accident cannot be mistaken for live catalogue data, and
 * every result set that uses them is tagged `origin: 'fixture'`.
 */
const CATALOGUE: Product[] = [
  {
    id: 'fx-dino-floor-puzzle',
    title: 'Dinosaur floor puzzle, 48 pieces',
    brand: 'Fixture Toys',
    imageUrl: '',
    variants: ['one size'],
    offers: [
      { merchant: 'Fixture Mart', price: 18.5, currency: 'USD', url: '', inStock: true, commissionRate: 0.04 },
      { merchant: 'Fixture Outlet', price: 21.0, currency: 'USD', url: '', inStock: true },
    ],
  },
  {
    id: 'fx-dino-nightlight',
    title: 'Dinosaur night light, rechargeable',
    brand: 'Fixture Home',
    imageUrl: '',
    variants: ['green', 'grey'],
    offers: [
      { merchant: 'Fixture Mart', price: 27.99, currency: 'USD', url: '', inStock: true },
      { merchant: 'Fixture Depot', price: 24.75, currency: 'USD', url: '', inStock: false },
    ],
  },
  {
    id: 'fx-dino-book-set',
    title: 'Illustrated dinosaur book set, 3 volumes',
    brand: 'Fixture Press',
    imageUrl: '',
    variants: ['hardcover'],
    offers: [
      { merchant: 'Fixture Books', price: 32.4, currency: 'USD', url: '', inStock: true, commissionRate: 0.06 },
    ],
  },
  {
    id: 'fx-merino-sweater',
    title: 'Merino wool crew sweater',
    brand: 'Fixture Knitwear',
    imageUrl: '',
    variants: ['S', 'M', 'L', 'XL'],
    offers: [
      { merchant: 'Fixture Apparel', price: 89.0, currency: 'USD', url: '', inStock: true },
      { merchant: 'Fixture Outlet', price: 76.5, currency: 'USD', url: '', inStock: true, commissionRate: 0.08 },
    ],
  },
  {
    id: 'fx-running-shoe',
    title: 'Neutral road running shoe',
    brand: 'Fixture Athletics',
    imageUrl: '',
    variants: ['8', '9', '10', '11'],
    offers: [
      { merchant: 'Fixture Sports', price: 129.0, currency: 'USD', url: '', inStock: true },
      { merchant: 'Fixture Mart', price: 118.25, currency: 'USD', url: '', inStock: true },
    ],
  },
  {
    id: 'fx-desk-lamp',
    title: 'Adjustable LED desk lamp',
    brand: 'Fixture Home',
    imageUrl: '',
    variants: ['black', 'white'],
    offers: [
      { merchant: 'Fixture Depot', price: 44.0, currency: 'USD', url: '', inStock: true },
    ],
  },
];

/**
 * A word-overlap match, not a search engine. It exists so a developer typing a
 * query offline sees a plausible subset rather than the whole catalogue every
 * time; when nothing overlaps it returns everything instead of an empty grid,
 * because an empty grid offline reads as a broken app.
 */
export function fixtureSearch(query: string, limit: number, why: string): SearchResult {
  const words = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const scored = CATALOGUE.map((p) => {
    const haystack = `${p.title} ${p.brand} ${p.variants.join(' ')}`.toLowerCase();
    return { p, score: words.filter((w) => w.length > 2 && haystack.includes(w)).length };
  });
  const matched = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  const chosen = (matched.length > 0 ? matched : scored).slice(0, limit).map((s) => s.p);

  return {
    origin: 'fixture',
    query,
    products: chosen,
    note: `Offline fixtures, not Channel3 results (${why}).`,
  };
}

export const fixtureCatalogueSize = CATALOGUE.length;
