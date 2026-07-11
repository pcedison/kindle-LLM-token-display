import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateIngestUrl } from './collectorConfig.mjs';
import { writeJsonStateAtomic } from './localState.mjs';
import { mergeQuotaSnapshots, normalizeQuotaSnapshot } from '../../app/api/dashboard/quotaSnapshot.mjs';

const PROVIDER_NAMES = ['claude', 'codex'];
const stateWriteQueues = new Map();

function isoTimestamp(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function provider(source, fallbackCollectedAt) {
  if (!Object.keys(source?.windows || {}).length) return null;
  const collectedAt = isoTimestamp(source.collectedAt ?? fallbackCollectedAt);
  return collectedAt ? { collectedAt, windows: source.windows } : null;
}

function normalizeUploadSnapshot(snapshot) {
  const normalized = normalizeQuotaSnapshot(snapshot);
  for (const name of PROVIDER_NAMES) {
    if (!normalized.providers[name]) continue;
    const collectedAt = isoTimestamp(snapshot.providers[name]?.collectedAt ?? normalized.collectedAt);
    if (!collectedAt) throw new TypeError('Invalid provider collectedAt');
    normalized.providers[name] = { collectedAt, windows: normalized.providers[name].windows };
  }
  return normalized;
}

function nowMilliseconds(now) {
  const value = Number(typeof now === 'function' ? now() : now);
  return Number.isFinite(value) ? value : Date.now();
}

function snapshotFromProviders(providers, fallbackCollectedAt) {
  const providerTimes = Object.values(providers).map(({ collectedAt }) => Date.parse(collectedAt));
  const collectedAt = providerTimes.length
    ? new Date(Math.max(...providerTimes)).toISOString()
    : fallbackCollectedAt;
  return { version: 1, collectedAt, providers };
}

async function serializeStateWrite(stateRoot, action) {
  const previous = stateWriteQueues.get(stateRoot) || Promise.resolve();
  const current = previous.catch(() => {}).then(action);
  stateWriteQueues.set(stateRoot, current);
  try {
    return await current;
  } finally {
    if (stateWriteQueues.get(stateRoot) === current) stateWriteQueues.delete(stateRoot);
  }
}

async function persistLatestUpload({ normalized, persistState, stateRoot }) {
  return serializeStateWrite(stateRoot, async () => {
    let retained = null;
    try { retained = JSON.parse(await readFile(join(stateRoot, 'last-upload.json'), 'utf8')); } catch {}
    let latest = normalized;
    if (retained) {
      try { latest = mergeQuotaSnapshots(retained, normalized); } catch {}
    }
    await persistState('last-upload.json', latest);
    return latest;
  });
}

export async function buildMergedLocalSnapshot({ stateRoot, codex, last = null, now = Date.now } = {}) {
  let claude = null;
  try { claude = JSON.parse(await readFile(join(stateRoot, 'claude.json'), 'utf8')); } catch {}
  let priorFromDisk = null;
  try { priorFromDisk = JSON.parse(await readFile(join(stateRoot, 'last-upload.json'), 'utf8')); } catch {}
  const prior = last || priorFromDisk;
  const currentCollectedAt = new Date(now()).toISOString();
  const retainedProviders = {};
  for (const name of PROVIDER_NAMES) {
    const retained = provider(prior?.providers?.[name], prior?.collectedAt);
    if (retained) retainedProviders[name] = retained;
  }
  const freshProviders = {};
  const c = provider(claude, claude?.collectedAt); if (c) freshProviders.claude = c;
  const codexSource = codex?.windows ? codex : codex ? { collectedAt: currentCollectedAt, windows: codex } : null;
  const x = provider(codexSource, currentCollectedAt); if (x) freshProviders.codex = x;
  const retainedSnapshot = snapshotFromProviders(retainedProviders, isoTimestamp(prior?.collectedAt) || currentCollectedAt);
  const freshSnapshot = snapshotFromProviders(freshProviders, currentCollectedAt);
  if (!Object.keys(retainedProviders).length) return freshSnapshot;
  if (!Object.keys(freshProviders).length) return retainedSnapshot;
  return mergeQuotaSnapshots(retainedSnapshot, freshSnapshot);
}

export async function uploadSnapshot({
  snapshot,
  ingestUrl,
  ingestToken,
  fetch: fetchImpl = fetch,
  stateRoot,
  timeoutMs = 30000,
  now = Date.now,
  writeState,
} = {}) {
  if (!ingestToken) throw new Error('Ingest token is required');
  const url = validateIngestUrl(ingestUrl);
  if (!snapshot?.providers || !Object.keys(snapshot.providers).length) return { uploaded: false };
  let normalized;
  try { normalized = normalizeUploadSnapshot(snapshot); } catch { throw new Error('Invalid normalized snapshot'); }
  await mkdir(stateRoot, { recursive: true });
  const persistState = writeState
    || ((name, value) => writeJsonStateAtomic(name, value, { root: stateRoot }));
  let timer;
  try {
    try { const backoff = JSON.parse(await readFile(join(stateRoot, 'upload-backoff.json'), 'utf8')); if (backoff.nextAttemptAt > nowMilliseconds(now)) return { uploaded: false, backedOff: true }; } catch {}
    const controller = new AbortController();
    let rejectTimeout;
    const timeoutPromise = new Promise((_, reject) => { rejectTimeout = reject; });
    timer = setTimeout(() => { controller.abort(); rejectTimeout(new Error('Upload timed out')); }, Math.min(120000, timeoutMs));
    let response;
    try { response = await Promise.race([fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${ingestToken}` }, body: JSON.stringify(normalized), signal: controller.signal }), timeoutPromise]); }
    catch { throw new Error('Upload failed'); }
    if (!response.ok) throw new Error('Upload rejected');
    if (response.body?.getReader) {
      const reader = response.body.getReader(); let total = 0;
      await Promise.race([(async () => { while (true) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > 4096) { await reader.cancel(); throw new Error('Upload response too large'); } } })(), timeoutPromise]);
    } else { await Promise.race([response.text().then((text) => { if (text.length > 4096) throw new Error('Upload response too large'); }), timeoutPromise]); }
    await persistLatestUpload({ normalized, persistState, stateRoot });
    await persistState('upload-backoff.json', { delayMs: 0 });
    return { uploaded: true };
  } catch (error) {
    let delayMs = 300000;
    try { const prior = JSON.parse(await readFile(join(stateRoot, 'upload-backoff.json'), 'utf8')); delayMs = Math.min(3600000, Math.max(300000, (prior.delayMs || 300000) * 2)); } catch {}
    await persistState('upload-backoff.json', { delayMs, nextAttemptAt: nowMilliseconds(now) + delayMs });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
