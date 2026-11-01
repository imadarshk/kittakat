import test from 'node:test';
import assert from 'node:assert/strict';
import { amountInput } from '../lib/amount-input.ts';
import { parseNpr } from '../lib/domain.ts';

test('editable NPR amounts preserve positive, negative, and zero paisa', () => {
  for (const [cents, expected] of [[0, '0.00'], [1, '0.01'], [29, '0.29'], [123456, '1234.56'], [-1, '-0.01'], [-123456, '-1234.56']] as const) {
    assert.equal(amountInput(cents), expected);
  }
});

test('editable NPR amounts preserve every paisa at both safe integer limits', () => {
  assert.equal(amountInput(Number.MAX_SAFE_INTEGER), '90071992547409.91');
  assert.equal(amountInput(Number.MIN_SAFE_INTEGER), '-90071992547409.91');
});

test('unchanged correction amounts round-trip through parseNpr without losing paisa', () => {
  for (const cents of [0, 1, -1, 29, -29, 123456, -123456, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1, Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER + 1]) {
    assert.equal(parseNpr(amountInput(cents)), cents, `Round-trip of ${cents} paisa`);
  }
});
