import test from 'node:test';
import assert from 'node:assert/strict';
import { colourName, nameSwatches } from './colours.js';

test('names the colours a shopper would ask for', () => {
  assert.equal(colourName('#1f2a44'), 'navy');
  assert.equal(colourName('#000080'), 'navy');
  assert.equal(colourName('#2f6fd6'), 'blue');
  assert.equal(colourName('#0a0a0a'), 'black');
  assert.equal(colourName('#fafafa'), 'white');
  assert.equal(colourName('#808080'), 'grey');
  assert.equal(colourName('#dcdcdb'), 'light grey');
  assert.equal(colourName('#5c3a21'), 'brown');
  assert.equal(colourName('#e8dcc4'), 'beige');
  assert.equal(colourName('#c0392b'), 'red');
  assert.equal(colourName('#6b1a2b'), 'burgundy');
  assert.equal(colourName('#2e7d32'), 'green');
  assert.equal(colourName('#556b2f'), 'olive');
});

test('an unreadable value is no colour, not a guess', () => {
  assert.equal(colourName('navy'), null);
  assert.equal(colourName('#12'), null);
});

test('merges shades, drops specks, keeps the order of coverage', () => {
  // The live sample's first product: two greys and a mauve tint.
  assert.deepEqual(
    nameSwatches([
      { hex: '#dcdcdb', percentage: 0.799 },
      { hex: '#9a8586', percentage: 0.1129 },
      { hex: '#bcbcb2', percentage: 0.0881 },
    ]),
    ['light grey 89%', 'grey 11%'],
  );
  assert.deepEqual(
    nameSwatches([
      { hex: '#1f2a44', percentage: 0.4 },
      { hex: '#202c48', percentage: 0.25 },
      { hex: '#ffffff', percentage: 0.3 },
      { hex: '#c0392b', percentage: 0.05 },
    ]),
    ['navy 65%', 'white 30%'],
  );
});

test('anything that is not a swatch list is no colours', () => {
  assert.deepEqual(nameSwatches(null), []);
  assert.deepEqual(nameSwatches([{ hex: 3 }, 'x']), []);
});
