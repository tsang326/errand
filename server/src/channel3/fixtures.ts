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
    description: 'A large-piece floor puzzle for ages 4 and up.',
    brand: 'Fixture Toys',
    imageUrl: '',
    imageAlt: '',
    category: 'Puzzles',
    categoryPath: ['Toys & Games', 'Puzzles'],
    attributes: { 'recommended-age-group': ['3-5 years'] },
    materials: [],
    keyFeatures: ['Large pieces for small hands'],
    variants: ['one size'],
    offers: [
      { url: '', domain: 'fixture-mart.example', price: 18.5, currency: 'USD', inStock: true, condition: 'new', commissionRate: 0.04 },
      { url: '', domain: 'fixture-outlet.example', price: 21.0, currency: 'USD', inStock: true, condition: 'new' },
    ],
  },
  {
    id: 'fx-dino-nightlight',
    title: 'Dinosaur night light, rechargeable',
    description: 'A soft night light shaped like a dinosaur.',
    brand: 'Fixture Home',
    imageUrl: '',
    imageAlt: '',
    category: 'Night Lights',
    categoryPath: ['Home', 'Lighting', 'Night Lights'],
    attributes: {},
    materials: [],
    keyFeatures: ['Rechargeable'],
    variants: ['green', 'grey'],
    offers: [
      { url: '', domain: 'fixture-mart.example', price: 27.99, currency: 'USD', inStock: true, condition: 'new' },
      { url: '', domain: 'fixture-depot.example', price: 24.75, currency: 'USD', inStock: false, condition: 'new' },
    ],
  },
  {
    id: 'fx-dino-book-set',
    title: 'Illustrated dinosaur book set, 3 volumes',
    description: 'Three hardcover volumes with full-page illustrations.',
    brand: 'Fixture Press',
    imageUrl: '',
    imageAlt: '',
    category: 'Childrens Books',
    categoryPath: ['Books', 'Childrens Books'],
    attributes: {},
    materials: [],
    keyFeatures: ['Hardcover'],
    variants: ['hardcover'],
    offers: [
      { url: '', domain: 'fixture-books.example', price: 32.4, currency: 'USD', inStock: true, condition: 'new', commissionRate: 0.06 },
    ],
  },
  {
    id: 'fx-merino-sweater',
    title: 'Merino wool crew sweater',
    description: 'A mid-weight crew neck in merino wool.',
    brand: 'Fixture Knitwear',
    imageUrl: '',
    imageAlt: '',
    category: 'Sweaters',
    categoryPath: ['Clothing', 'Sweaters'],
    attributes: { 'material': ['Merino wool'] },
    materials: [],
    keyFeatures: ['Machine washable'],
    variants: ['S', 'M', 'L', 'XL'],
    offers: [
      { url: '', domain: 'fixture-apparel.example', price: 89.0, currency: 'USD', inStock: true, condition: 'new' },
      { url: '', domain: 'fixture-outlet.example', price: 76.5, currency: 'USD', inStock: true, condition: 'new', commissionRate: 0.08 },
    ],
  },
  {
    id: 'fx-running-shoe',
    title: 'Neutral road running shoe',
    description: 'A neutral trainer for road mileage.',
    brand: 'Fixture Athletics',
    imageUrl: '',
    imageAlt: '',
    category: 'Running Shoes',
    categoryPath: ['Shoes', 'Running Shoes'],
    attributes: {},
    materials: [],
    keyFeatures: ['Neutral support'],
    variants: ['8', '9', '10', '11'],
    offers: [
      { url: '', domain: 'fixture-sports.example', price: 129.0, currency: 'USD', inStock: true, condition: 'new' },
      { url: '', domain: 'fixture-mart.example', price: 118.25, currency: 'USD', inStock: true, condition: 'new' },
    ],
  },
  {
    id: 'fx-desk-lamp',
    title: 'Adjustable LED desk lamp',
    description: 'An LED desk lamp with an adjustable arm.',
    brand: 'Fixture Home',
    imageUrl: '',
    imageAlt: '',
    category: 'Desk Lamps',
    categoryPath: ['Home', 'Lighting', 'Desk Lamps'],
    attributes: {},
    materials: [],
    keyFeatures: ['Three brightness levels'],
    variants: ['black', 'white'],
    offers: [
      { url: '', domain: 'fixture-depot.example', price: 44.0, currency: 'USD', inStock: true, condition: 'new' },
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
