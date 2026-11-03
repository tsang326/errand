import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchProducts } from './client.js';
import { fixtureSearch } from './fixtures.js';
import { cheapestOffer } from './types.js';

test('with no API key, a search is answered from fixtures and says so', async () => {
  const before = process.env.CHANNEL3_API_KEY;
  delete process.env.CHANNEL3_API_KEY;
  try {
    const r = await searchProducts({ query: 'dinosaur gift for a six year old' });
    assert.equal(r.origin, 'fixture');
    assert.ok(r.products.length > 0);
    assert.match(r.note ?? '', /not Channel3 results/);
  } finally {
    if (before !== undefined) process.env.CHANNEL3_API_KEY = before;
  }
});

test('a fixture search never returns an empty grid', () => {
  const r = fixtureSearch('zzzz nothing matches this', 24, 'test');
  assert.ok(r.products.length > 0);
});

test('fixture matching prefers overlapping words', () => {
  const r = fixtureSearch('merino sweater', 24, 'test');
  assert.match(r.products[0]?.title ?? '', /merino/i);
});

test('cheapest offer skips out-of-stock listings', () => {
  const p = {
    id: 'p',
    title: 't',
    brand: 'b',
    imageUrl: '',
    variants: [],
    offers: [
      { merchant: 'cheap but gone', price: 10, currency: 'USD', url: '', inStock: false },
      { merchant: 'available', price: 20, currency: 'USD', url: '', inStock: true },
    ],
  };
  assert.equal(cheapestOffer(p)?.merchant, 'available');
});
