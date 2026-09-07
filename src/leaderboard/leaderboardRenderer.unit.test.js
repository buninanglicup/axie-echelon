import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRuneBadgeLabel, coerceCompatibleRune } from './runeBadgeUtil.js';

test('formatRuneBadgeLabel uses name then id when name present', () => {
  const r = { id: 'rune-1', name: 'Blazing Orb' };
  assert.equal(formatRuneBadgeLabel(r), 'Blazing Orb (rune-1)');
});

test('formatRuneBadgeLabel falls back to id when name absent', () => {
  const r = { id: 'rune-2', name: null };
  assert.equal(formatRuneBadgeLabel(r), 'rune-2');
});

test('formatRuneBadgeLabel coerces numeric id to string', () => {
  const r = { id: 123 };
  assert.equal(formatRuneBadgeLabel(r), '123');
});

test('formatRuneBadgeLabel handles undefined/null gracefully', () => {
  assert.equal(formatRuneBadgeLabel(null), '');
  assert.equal(formatRuneBadgeLabel(undefined), '');
});

test('coerceCompatibleRune accepts string rune IDs and object rune metadata', () => {
  assert.deepEqual(coerceCompatibleRune({ runes: ['rune-123'] }), { id: 'rune-123', name: null, imageUrl: null });
  assert.deepEqual(coerceCompatibleRune({ runes: [{ id: 456, name: 'Blazing Orb', imageUrl: 'https://example.test/rune.png' }] }), {
    id: '456',
    name: 'Blazing Orb',
    imageUrl: 'https://example.test/rune.png'
  });
});
