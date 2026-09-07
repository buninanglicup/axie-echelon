import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLivePanelVisibility } from './livePanelUtil.js';

test('computeLivePanelVisibility hides panel for manual historical scope', () => {
  assert.equal(computeLivePanelVisibility(true), false);
  assert.equal(computeLivePanelVisibility(false), true);
  assert.equal(computeLivePanelVisibility(undefined), true);
});
