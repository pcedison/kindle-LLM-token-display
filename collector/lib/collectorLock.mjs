import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

function currentMilliseconds(now) {
  const value = typeof now === 'function' ? now() : now;
  const milliseconds = new Date(value ?? Date.now()).getTime();
  return Number.isNaN(milliseconds) ? Date.now() : milliseconds;
}

function parseClaim(record) {
  try {
    const claim = JSON.parse(record);
    const keys = claim && !Array.isArray(claim) ? Object.keys(claim).sort() : [];
    const createdAtMs = Date.parse(claim?.createdAt);
    if (
      keys.length !== 2
      || keys[0] !== 'createdAt'
      || keys[1] !== 'pid'
      || !Number.isSafeInteger(claim.pid)
      || claim.pid < 1
      || !Number.isFinite(createdAtMs)
      || new Date(createdAtMs).toISOString() !== claim.createdAt
    ) {
      return null;
    }
    return { pid: claim.pid, createdAtMs };
  } catch {
    return null;
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

async function claimBlocks(record, { nowMs, staleAfterMs, isProcessAlive }) {
  const claim = parseClaim(record);
  if (!claim) return true;
  if (nowMs - claim.createdAtMs <= staleAfterMs) return true;
  try {
    return await isProcessAlive(claim.pid);
  } catch {
    return true;
  }
}

async function legacyLockBlocks(lockPath, options) {
  try {
    return await claimBlocks(await readFile(lockPath, 'utf8'), options);
  } catch (error) {
    return error?.code !== 'ENOENT';
  }
}

async function removeIfOwned(claimPath, record) {
  try {
    if (await readFile(claimPath, 'utf8') === record) {
      await rm(claimPath);
    }
  } catch {
    // The unique claim was already removed or replaced by local tampering.
  }
}

async function otherClaimBlocks({
  claimsPath,
  ownName,
  nowMs,
  staleAfterMs,
  isProcessAlive,
}) {
  let entries;
  try {
    entries = await readdir(claimsPath, { withFileTypes: true });
  } catch {
    return true;
  }

  for (const entry of entries) {
    if (entry.name === ownName) continue;
    if (!entry.isFile()) return true;
    const claimPath = join(claimsPath, entry.name);
    let record;
    try {
      record = await readFile(claimPath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      return true;
    }
    if (await claimBlocks(record, { nowMs, staleAfterMs, isProcessAlive })) {
      return true;
    }

    // Unique claim names are never reused. Recheck the bytes and PID before
    // deleting only this dead owner's path.
    const claim = parseClaim(record);
    try {
      if (await isProcessAlive(claim.pid)) return true;
      if (await readFile(claimPath, 'utf8') !== record) return true;
      await rm(claimPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') return true;
    }
  }
  return false;
}

export async function withCollectorLock({
  stateRoot,
  action,
  now = Date.now,
  staleAfterMs = 2 * 60 * 1000,
  isProcessAlive = processIsAlive,
} = {}) {
  if (!stateRoot || typeof action !== 'function') {
    throw new TypeError('Collector lock requires a state root and action');
  }

  await mkdir(stateRoot, { recursive: true });
  const claimsPath = join(stateRoot, 'collector.lock.d');
  await mkdir(claimsPath, { recursive: true });
  const nowMs = currentMilliseconds(now);
  const ownName = `${randomUUID()}.json`;
  const claimPath = join(claimsPath, ownName);
  const temporaryClaimPath = join(stateRoot, `.collector-claim-${ownName}.tmp`);
  const record = JSON.stringify({
    pid: process.pid,
    createdAt: new Date(nowMs).toISOString(),
  });

  let handle;
  try {
    handle = await open(temporaryClaimPath, 'wx');
    await handle.writeFile(record, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryClaimPath, claimPath);

    const options = { nowMs, staleAfterMs, isProcessAlive };
    if (
      await legacyLockBlocks(join(stateRoot, 'collector.lock'), options)
      || await otherClaimBlocks({ claimsPath, ownName, ...options })
    ) {
      return { skipped: true, reason: 'locked' };
    }
    return await action();
  } finally {
    try { await handle?.close(); } catch {}
    try { await rm(temporaryClaimPath, { force: true }); } catch {}
    await removeIfOwned(claimPath, record);
  }
}
