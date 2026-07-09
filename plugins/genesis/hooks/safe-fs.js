'use strict';
const fs = require('fs');
const path = require('path');

// Refuses to write through a symlinked directory component between cwd and
// the target path — closes the gap where a malicious cloned repo ships a
// tracked directory as a symlink to write files outside the project.
function assertNoSymlinkInPath(cwd, targetDir) {
  const rel = path.relative(cwd, targetDir);
  let cur = cwd;
  for (const part of rel.split(path.sep).filter(Boolean)) {
    cur = path.join(cur, part);
    let st;
    try { st = fs.lstatSync(cur); } catch { return; } // not created yet — fine
    if (st.isSymbolicLink()) {
      throw new Error(`refusing to write through symlinked path: ${cur}`);
    }
  }
}

function writeFileSafe(cwd, filePath, contents, opts) {
  const backup = !opts || opts.backup !== false;
  assertNoSymlinkInPath(cwd, path.dirname(filePath));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    if (fs.lstatSync(filePath).isSymbolicLink()) {
      throw new Error(`refusing to write: ${filePath} is a symlink`);
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (backup && fs.existsSync(filePath)) {
    try { fs.copyFileSync(filePath, filePath + '.bak'); } catch { /* backup failure must not block the write */ }
  }
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, filePath);
}

// Advisory lock via O_EXCL. Stale locks (LOCK_STALE_MS old) are treated as
// abandoned so a crashed process can't wedge future callers forever.
const LOCK_STALE_MS = 10000;
const LOCK_RETRY_MS = 20;
const LOCK_TIMEOUT_MS = 2000;

function acquireLock(lockPath) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      return lockPath;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let age = Infinity;
      try { age = Date.now() - fs.statSync(lockPath).mtimeMs; } catch { /* raced away */ }
      if (age > LOCK_STALE_MS) {
        try { fs.unlinkSync(lockPath); } catch { /* raced away, retry loop handles it */ }
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for lock: ${lockPath}`);
      }
      const buf = new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(buf, 0, 0, LOCK_RETRY_MS);
    }
  }
}

function releaseLock(lockPath) {
  try { fs.unlinkSync(lockPath); } catch { /* best-effort */ }
}

function withLock(lockPath, fn) {
  acquireLock(lockPath);
  try {
    return fn();
  } finally {
    releaseLock(lockPath);
  }
}

module.exports = {
  assertNoSymlinkInPath, writeFileSafe, acquireLock, releaseLock, withLock,
  LOCK_STALE_MS, LOCK_RETRY_MS, LOCK_TIMEOUT_MS
};
