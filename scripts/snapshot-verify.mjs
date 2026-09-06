#!/usr/bin/env node
import path from 'node:path';
import { verifySnapshots } from '../src/server/snapshots/snapshotVerifier.js';

const args = process.argv.slice(2);
let root = path.resolve('data', 'snapshots');
for (let i = 0; i < args.length; i++) {
  if ((args[i] === '--root' || args[i] === '-r') && args[i+1]) {
    root = path.resolve(args[i+1]);
    i += 1;
  }
}

(async () => {
  try {
    const result = await verifySnapshots(root);
    // print concise safe summary
    console.log('Snapshot verification summary:');
    console.log('  root:', result.root);
    if (result.message === 'no local snapshots found') {
      console.log('  result: no local snapshots found');
      process.exit(0);
    }
    console.log('  scopesChecked:', result.scopesChecked);
    console.log('  capturesChecked:', result.capturesChecked);
    console.log('  acceptedCaptures:', result.acceptedCaptures);
    if (result.warnings.length) {
      console.log('  warnings:');
      for (const w of result.warnings) console.log('   -', w.scope, w.warning);
    }
    if (result.errors.length) {
      console.log('  errors:');
      for (const e of result.errors) console.log('   -', e.scope || '(unknown)', e.capture ? `${e.capture}:` : '', e.error);
      process.exit(2);
    }
    console.log('  status: ok');
    process.exit(0);
  } catch (err) {
    console.error('Verification failed:', err && err.message ? err.message : String(err));
    process.exit(3);
  }
})();
