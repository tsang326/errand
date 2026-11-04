import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { searchProducts, searchPages, normalise, verdictFrom } from './client.js';
import { fixtureSearch } from './fixtures.js';
import { cheapestOffer, bestCommission, type Product, type SearchResult } from './types.js';

const liveSample = JSON.parse(
  readFileSync(new URL('../fixtures/live-search-sample.json', import.meta.url), 'utf8'),
) as { products: unknown[] };

/**
 * The suite runs with CHANNEL3_API_KEY empty (see package.json): config reads
 * env once at import, so the no-key path cannot be reached by deleting the
 * variable afterwards.
 */
test('with no API key, a search is answered from fixtures and says so', async () => {
  const r = await searchProducts({ query: 'dinosaur gift for a six year old' });
  assert.equal(r.origin, 'fixture');
  assert.ok(r.products.length > 0);
  assert.match(r.note ?? '', /not Channel3 results/);
});

test('a fixture search never returns an empty grid', () => {
  assert.ok(fixtureSearch('zzzz nothing matches this', 24, 'test').products.length > 0);
});

test('fixture matching prefers overlapping words', () => {
  assert.match(fixtureSearch('merino sweater', 24, 'test').products[0]?.title ?? '', /merino/i);
});

/**
 * The guard against the mistake already made once: this app's shape was first
 * written from the docs' prose and got brand, image and price all wrong. The
 * sample is a real recorded response with the account ids stripped.
 */
test('normalise reads a recorded live response', () => {
  const products = normalise(liveSample.products);
  assert.equal(products.length, liveSample.products.length);

  const p = products[0]!;
  assert.ok(p.title.length > 0, 'title');
  assert.ok(p.brand.length > 0, 'brand comes out of brands[].name');
  assert.ok(p.imageUrl.startsWith('https://'), 'image comes out of images[]');
  assert.ok(p.categoryPath.length > 1, 'category path is broad-to-narrow');
  assert.ok(p.offers.length > 0, 'offers survive');

  const o = p.offers[0]!;
  assert.ok(o.price > 0, 'price is lifted out of offers[].price.price');
  assert.ok(o.domain.includes('.'), 'the retailer is a domain');
  assert.equal(typeof o.inStock, 'boolean');
});

test('an offer that is not explicitly InStock is treated as unbuyable', () => {
  const [p] = normalise([
    { id: 'x', title: 'x', offers: [{ price: { price: 5, currency: 'USD' }, availability: 'Unknown' }] },
  ]);
  assert.equal(p?.offers[0]?.inStock, false);
});

test('a row missing every optional field still maps', () => {
  const [p] = normalise([{ id: 'bare' }]);
  assert.equal(p?.id, 'bare');
  assert.deepEqual(p?.offers, []);
  assert.equal(p?.brand, '');
});

test('cheapest offer skips out-of-stock listings', () => {
  const p: Product = {
    id: 'p', title: 't', description: '', brand: 'b', imageUrl: '', imageAlt: '',
    category: '', categoryPath: [], attributes: {}, materials: [], keyFeatures: [], variants: [],
    offers: [
      { url: '', domain: 'cheap-but-gone.example', price: 10, currency: 'USD', inStock: false, condition: 'new' },
      { url: '', domain: 'available.example', price: 20, currency: 'USD', inStock: true, condition: 'new', commissionRate: 0.05 },
    ],
  };
  assert.equal(cheapestOffer(p)?.domain, 'available.example');
  assert.equal(bestCommission(p), 0.05);
});

test('a price the history has moved on from is reported as a disagreement', async () => {
  // The real case, from 2026-11-04: /search served $120 while the same
  // product's tracked history had stepped to $304.17 on 31 October.
  const points = [
    { date: '2026-10-29', price: 120 },
    { date: '2026-10-30', price: 120 },
    { date: '2026-10-31', price: 304.17 },
    { date: '2026-11-04', price: 304.17 },
  ];
  const check = verdictFrom('exWNalp', 120, points);
  assert.equal(check.disagrees, true);
  assert.equal(check.trackedPrice, 304.17);
  assert.deepEqual(check.lastChange, { from: 120, to: 304.17, date: '2026-10-31' });
});

test('a price the history agrees with raises nothing', () => {
  const points = [
    { date: '2026-11-03', price: 16.99 },
    { date: '2026-11-04', price: 16.99 },
  ];
  const check = verdictFrom('ADcIUjY', 16.99, points);
  assert.equal(check.disagrees, false);
  assert.equal(check.lastChange, null);
});

test('a product with no tracked history never claims the price was confirmed', () => {
  const check = verdictFrom('untracked', 42, []);
  assert.equal(check.disagrees, false);
  assert.equal(check.trackedPrice, null);
  assert.equal(check.trackedOn, null);
});

test('cents of float drift are not a disagreement', () => {
  const check = verdictFrom('p', 19.99, [{ date: '2026-11-04', price: 19.990000000000002 }]);
  assert.equal(check.disagrees, false);
});

/**
 * Paging is what a pass buys, so the rules around it are worth pinning: no
 * duplicate rows, no infinite token loop, and a page that fails costs the page
 * rather than the search.
 */
const page = (ids: string[], token?: string): SearchResult => ({
  origin: 'live',
  query: 'q',
  products: ids.map((id) => ({
    id,
    title: id,
    brand: '',
    category: '',
    categoryPath: [],
    description: '',
    image: '',
    materials: [],
    colors: [],
    attributes: {},
    keyFeatures: [],
    variants: [],
    offers: [],
  })) as unknown as Product[],
  ...(token ? { nextPageToken: token } : {}),
});

test('three pages are merged, in order, with no duplicate rows', async () => {
  const pages = [page(['a', 'b'], 't1'), page(['b', 'c'], 't2'), page(['d'], 't3')];
  let n = 0;
  const r = await searchPages({ query: 'q' }, 3, async () => pages[n++]!);
  assert.deepEqual(r.products.map((p) => p.id), ['a', 'b', 'c', 'd']);
  assert.equal(r.pagesRead, 3);
  assert.equal(n, 3);
});

test('a page that repeats itself stops the loop instead of spinning on a token', async () => {
  let n = 0;
  const r = await searchPages({ query: 'q' }, 5, async () => {
    n += 1;
    return page(['a', 'b'], 'same-token');
  });
  assert.deepEqual(r.products.map((p) => p.id), ['a', 'b']);
  assert.equal(n, 2);
});

test('one page asked for still reports one page read, so the page can say so', async () => {
  const r = await searchPages({ query: 'q' }, 1, async () => page(['a'], 'tok'));
  assert.equal(r.pagesRead, 1);
});

test('no page token means no further call, whatever the page count asked for', async () => {
  let n = 0;
  const r = await searchPages({ query: 'q' }, 4, async () => {
    n += 1;
    return page(['a']);
  });
  assert.equal(n, 1);
  assert.equal(r.pagesRead, 1);
});

test('a failed second page keeps the first rather than losing the search', async () => {
  let n = 0;
  const r = await searchPages({ query: 'q' }, 3, async () => {
    n += 1;
    if (n === 1) return page(['a', 'b'], 't1');
    throw new Error('channel3 500');
  });
  assert.deepEqual(r.products.map((p) => p.id), ['a', 'b']);
  assert.equal(r.pagesRead, 1);
});

test('one page asked for is one page read, and the token is passed on', async () => {
  const seen: (string | undefined)[] = [];
  await searchPages({ query: 'q' }, 3, async (o) => {
    seen.push(o.pageToken);
    return page([`p${seen.length}`], 'tok');
  });
  assert.deepEqual(seen, [undefined, 'tok', 'tok']);
});
