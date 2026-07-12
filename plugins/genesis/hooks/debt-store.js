'use strict';
const fs = require('fs');
const path = require('path');
const { writeFileSafe, withLock } = require('./safe-fs');

const MAX_DEBT_BYTES = 2 * 1024 * 1024;

function debtPath(cwd) { return path.join(cwd, 'docs', 'sdlc', 'debt.json'); }

function emptyDebt() { return { version: 1, items: [] }; }

function readDebt(cwd) {
  try {
    const p = debtPath(cwd);
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink() || !st.isFile() || st.size > MAX_DEBT_BYTES) return emptyDebt();
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!data || typeof data !== 'object' || data.version !== 1 || !Array.isArray(data.items)) return emptyDebt();
    return data;
  } catch {
    return emptyDebt();
  }
}

function writeDebtUnlocked(cwd, debt) {
  const json = JSON.stringify(debt, null, 2) + '\n';
  if (Buffer.byteLength(json) > MAX_DEBT_BYTES) {
    throw new Error(`debt ledger exceeds ${MAX_DEBT_BYTES}-byte cap (${Buffer.byteLength(json)} bytes) — not written`);
  }
  writeFileSafe(cwd, debtPath(cwd), json, { backup: false });
}

// Read-modify-write under one lock acquisition — same reason
// graph-store.js's mutateGraph exists instead of separate readGraph/
// writeGraph calls: closes the lost-update race between two concurrent
// PostToolUse hooks.
function mutateDebt(cwd, mutator) {
  return withLock(debtPath(cwd) + '.lock', () => {
    const debt = readDebt(cwd);
    const { debt: nextDebt, result } = mutator(debt);
    writeDebtUnlocked(cwd, nextDebt);
    return result;
  });
}

// Reconciles one file's currently-found markers into the ledger. Rows for
// lines no longer present in `found` are dropped (the corner was resolved
// or the code moved on). A row whose ceiling/trigger/noTrigger is byte-
// identical to the prior scan keeps its original `addedAt` — this is what
// lets a later report show how long a shortcut has been outstanding,
// instead of resetting the clock on every touch of the file. Anything new
// or changed gets today's timestamp.
// Accepted tradeoff of line-based keying (not fixed here): because rows are
// keyed by (file, line), an edit that shifts a marker to a different line
// number (by adding/removing lines above it) is treated as a new row and
// resets its addedAt, even though it's the same deliberate shortcut.
function reconcileFileMarkers(cwd, relFile, found) {
  return mutateDebt(cwd, (debt) => {
    const others = debt.items.filter((it) => it.file !== relFile);
    const prior = new Map(debt.items.filter((it) => it.file === relFile).map((it) => [it.line, it]));
    const now = new Date().toISOString();
    const nextItems = found.map((f) => {
      const existing = prior.get(f.line);
      const unchanged = existing
        && existing.ceiling === f.ceiling && existing.trigger === f.trigger && existing.noTrigger === f.noTrigger;
      return {
        file: relFile,
        line: f.line,
        ceiling: f.ceiling,
        trigger: f.trigger,
        noTrigger: f.noTrigger,
        addedAt: unchanged ? existing.addedAt : now,
      };
    });
    return { debt: { ...debt, items: [...others, ...nextItems] }, result: { count: nextItems.length } };
  });
}

// Batched form of reconcileFileMarkers: reconciles many files' markers in ONE
// mutateDebt (one lock/read/write) instead of one per file. Semantically it is
// exactly reconcileFileMarkers applied to each entry in order — each file only
// replaces its OWN rows (addedAt preserved when a row is byte-identical),
// other files' rows are untouched — so the final ledger is identical to calling
// reconcileFileMarkers per file. Used by graph-index's indexFilesBatch so a
// large baseline scan doesn't re-read/re-serialize the whole ledger N times.
function reconcileFilesMarkers(cwd, perFile) {
  return mutateDebt(cwd, (debt) => {
    let items = debt.items;
    const now = new Date().toISOString();
    for (const { relFile, found } of perFile) {
      const others = items.filter((it) => it.file !== relFile);
      const prior = new Map(items.filter((it) => it.file === relFile).map((it) => [it.line, it]));
      const nextItems = found.map((f) => {
        const existing = prior.get(f.line);
        const unchanged = existing
          && existing.ceiling === f.ceiling && existing.trigger === f.trigger && existing.noTrigger === f.noTrigger;
        return {
          file: relFile,
          line: f.line,
          ceiling: f.ceiling,
          trigger: f.trigger,
          noTrigger: f.noTrigger,
          addedAt: unchanged ? existing.addedAt : now,
        };
      });
      items = [...others, ...nextItems];
    }
    return { debt: { ...debt, items }, result: { count: items.length } };
  });
}

module.exports = {
  debtPath, emptyDebt, readDebt, writeDebtUnlocked, mutateDebt, reconcileFileMarkers,
  reconcileFilesMarkers, MAX_DEBT_BYTES,
};
