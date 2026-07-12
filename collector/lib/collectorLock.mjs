import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

function currentMilliseconds(now) {
  const value = typeof now === 'function' ? now() : now;
  const milliseconds = new Date(value ?? Date.now()).getTime();
  return Number.isNaN(milliseconds) ? Date.now() : milliseconds;
}

async function removeIfOwned(lockPath, record) {
  try {
    if (await readFile(lockPath, 'utf8') === record) {
      await rm(lockPath, { force: true });
    }
  } catch {
    // The lock was already removed or replaced.
  }
}

export async function withCollectorLock({
  stateRoot,
  action,
  now = Date.now,
  staleAfterMs = 2 * 60 * 1000,
} = {}) {
  if (!stateRoot || typeof action !== 'function') {
    throw new TypeError('Collector lock requires a state root and action');
  }

  await mkdir(stateRoot, { recursive: true });
  const lockPath = join(stateRoot, 'collector.lock');

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const createdAtMs = currentMilliseconds(now);
    const record = JSON.stringify({ pid: process.pid, createdAt: new Date(createdAtMs).toISOString() });
    let handle;
    try {
      handle = await open(lockPath, 'wx');
      await handle.writeFile(record, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      try {
        return await action();
      } finally {
        await removeIfOwned(lockPath, record);
      }
    } catch (error) {
      try { await handle?.close(); } catch {}
      if (error?.code !== 'EEXIST') throw error;

      let stale = false;
      try {
        const existing = JSON.parse(await readFile(lockPath, 'utf8'));
        const created = Date.parse(existing?.createdAt);
        stale = Number.isFinite(created) && createdAtMs - created > staleAfterMs;
      } catch (readError) {
        if (readError?.code === 'ENOENT') {
          stale = true;
        } else {
          try {
            const metadata = await stat(lockPath);
            stale = createdAtMs - metadata.mtimeMs > staleAfterMs;
          } catch {
            stale = false;
          }
        }
      }

      if (!stale || attempt > 0) {
        return { skipped: true, reason: 'locked' };
      }
      try { await rm(lockPath, { force: true }); } catch {}
    }
  }

  return { skipped: true, reason: 'locked' };
}
