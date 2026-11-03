import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { searchProducts, normalise } from './client.js';
import { fixtureSearch } from './fixtures.js';
import { cheapestOffer, bestCommission, type Product } from './types.js';

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
    category: '', categoryPath: [], attributes: {}, keyFeatures: [], variants: [],
    offers: [
      { url: '', domain: 'cheap-but-gone.example', price: 10, currency: 'USD', inStock: false, condition: 'new' },
      { url: '', domain: 'available.example', price: 20, currency: 'USD', inStock: true, condition: 'new', commissionRate: 0.05 },
    ],
  };
  assert.equal(cheapestOffer(p)?.domain, 'available.example');
  assert.equal(bestCommission(p), 0.05);
});
