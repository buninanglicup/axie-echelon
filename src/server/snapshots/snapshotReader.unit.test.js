import test from 'node:test';
import assert from 'node:assert/strict';
import { extractHistoricalTeam } from './snapshotReader.js';

test('mapSnapshotFighter populates singular rune field from runes array', () => {
  const normalizedBattleLog = {
    selectedTeam: {
      fighters: [
        {
          axieID: 123,
          position: 1,
          runes: [{ id: 'rune-123', name: 'Blazing Orb', imageUrl: null }]
        }
      ]
    }
  };

  const team = extractHistoricalTeam('any-user', normalizedBattleLog);
  assert.ok(team && Array.isArray(team.fighters));
  const f = team.fighters[0];
  assert.equal(f.rune && f.rune.id, 'rune-123');
  assert.ok(Array.isArray(f.runes));
  assert.equal(f.runes[0].id, 'rune-123');
});

test('mapSnapshotFighter leaves rune null when no runes present', () => {
  const normalizedBattleLog = {
    selectedTeam: {
      fighters: [
        { axieID: 456, position: 1 }
      ]
    }
  };

  const team = extractHistoricalTeam('any-user', normalizedBattleLog);
  const f = team.fighters[0];
  assert.equal(f.rune, null);
  assert.deepEqual(f.runes, []);
});

test('mapSnapshotFighter normalizes string rune IDs into object with null name/image', () => {
  const normalizedBattleLog = {
    selectedTeam: {
      fighters: [
        {
          axieID: 789,
          position: 1,
          runes: ['rune-xyz']
        }
      ]
    }
  };

  const team = extractHistoricalTeam('any-user', normalizedBattleLog);
  const f = team.fighters[0];
  assert.equal(f.rune && f.rune.id, 'rune-xyz');
  assert.equal(f.rune && f.rune.name, null);
  assert.equal(f.rune && f.rune.imageUrl, null);
  assert.ok(Array.isArray(f.runes));
  assert.equal(f.runes[0], 'rune-xyz');
});

test('mapSnapshotFighter falls back to runes[] when rune object lacks id/name', () => {
  const normalizedBattleLog = {
    selectedTeam: {
      fighters: [
        {
          axieID: 202,
          position: 1,
          runes: [{ unknownField: 'x' }, 'rune-fallback']
        }
      ]
    }
  };

  const team = extractHistoricalTeam('any-user', normalizedBattleLog);
  const f = team.fighters[0];
  // normalization will set rune to null because object has no id, but renderer
  // fallback uses runes[1] if present. Here assert raw array preserved.
  assert.equal(f.rune, null);
  assert.equal(f.runes[1], 'rune-fallback');
});

test('mapSnapshotFighter coerces numeric/object rune ids to string ids', () => {
  const normalizedBattleLog = {
    selectedTeam: {
      fighters: [
        {
          axieID: 101,
          position: 1,
          runes: [{ id: 456, name: null }]
        }
      ]
    }
  };

  const team = extractHistoricalTeam('any-user', normalizedBattleLog);
  const f = team.fighters[0];
  assert.equal(f.rune && f.rune.id, '456');
  assert.equal(f.rune && f.rune.name, null);
});

test('extractHistoricalTeam hydrates known rune ID from local registry', () => {
  // Use a known rune ID from repository runes.json
  const knownRuneId = 'rune_dusk_40040_s18';
  const normalizedBattleLog = {
    selectedTeam: {
      fighters: [
        {
          axieID: 999,
          position: 1,
          runes: [knownRuneId]
        }
      ]
    }
  };

  const team = extractHistoricalTeam('any-user', normalizedBattleLog);
  const f = team.fighters[0];

  // fighter.rune must preserve the ID
  assert.equal(f.rune.id, knownRuneId);
  // Registry hydration provides name and imageUrl
  assert.equal(f.rune.name, 'Wicked Ward Lv.4');
  assert.equal(f.rune.imageUrl, 'https://storage.googleapis.com/origin-production/assets/item/rune_dusk_defensive_1.png');
  // Original runes[] array remains unchanged
  assert.deepEqual(f.runes, [knownRuneId]);
});

test('extractHistoricalTeam leaves unknown rune ID without registry hydration', () => {
  // Use an ID not in the local rune registry
  const unknownRuneId = 'rune_unknown_xyz_999';
  const normalizedBattleLog = {
    selectedTeam: {
      fighters: [
        {
          axieID: 888,
          position: 1,
          runes: [unknownRuneId]
        }
      ]
    }
  };

  const team = extractHistoricalTeam('any-user', normalizedBattleLog);
  const f = team.fighters[0];

  // fighter.rune preserves the original ID
  assert.equal(f.rune.id, unknownRuneId);
  // No local registry match exists; name and imageUrl remain null
  assert.equal(f.rune.name, null);
  assert.equal(f.rune.imageUrl, null);
  // Original runes[] array remains unchanged
  assert.deepEqual(f.runes, [unknownRuneId]);
});
