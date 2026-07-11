import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const trackedFiles = execFileSync('git', [
  '-c', `safe.directory=${repositoryRoot}`,
  'ls-files', '-z',
], {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).split('\0').filter(Boolean);

const publicTextFiles = trackedFiles.filter((path) => {
  if (path === 'tests/openSourceRelease.test.mjs' || path.endsWith('.png')) return false;
  return path === 'README.md'
    || path === '.env.example'
    || path === '.gitignore'
    || path.startsWith('.github/')
    || path.startsWith('app/')
    || path.startsWith('collector/')
    || path.startsWith('docs/')
    || path.startsWith('kindle-extension/');
});

test('ships an MIT license and public documentation set', () => {
  const license = read('LICENSE');
  assert.match(license, /MIT License/);
  assert.match(license, /Copyright \(c\) 2026 pcedison/);
  for (const file of ['docs/SECURITY.md', 'docs/ARCHITECTURE.md', 'docs/WINDOWS-COLLECTOR.md', 'docs/VERCEL-SETUP.md']) {
    assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), `${file} must exist`);
  }
});

test('ships pull-request CI for Windows behavior and Kindle shell syntax', () => {
  const workflowPath = '.github/workflows/ci.yml';
  assert.ok(existsSync(new URL(`../${workflowPath}`, import.meta.url)), `${workflowPath} must exist`);
  const workflow = read(workflowPath);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /push:/);
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /ubuntu-latest/);
  assert.match(workflow, /actions\/checkout@v6/);
  assert.match(workflow, /actions\/setup-node@v6/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /bash -n/);
});

test('declares ESM consistently without a module reparse warning', () => {
  const packageJson = JSON.parse(read('package.json'));
  assert.equal(packageJson.type, 'module');
  assert.ok(existsSync(new URL('../next.config.mjs', import.meta.url)));
  assert.equal(existsSync(new URL('../next.config.js', import.meta.url)), false);
  assert.match(read('next.config.mjs'), /export default nextConfig/);
});

test('public defaults contain no owner-specific deployment or identity', () => {
  const publicText = publicTextFiles.map(read).join('\n');
  assert.doesNotMatch(publicText, /https:\/\/(?!your-project\.)[^/\s]+\.vercel\.app/i);
  assert.doesNotMatch(publicText, /pcedison@gmail\.com|C:\\Users\\[A-Za-z0-9._-]+|D:\\extensions/i);
  assert.doesNotMatch(publicText, /sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9_-]{24,}/i);
});

test('local environment files are ignored and only the example is tracked', () => {
  const ignore = read('.gitignore');
  assert.match(ignore, /^\.env$/m);
  assert.match(ignore, /^\.env\.\*$/m);
  assert.match(ignore, /^!\.env\.example$/m);
  assert.match(ignore, /^\.vercel\/$/m);
  assert.deepEqual(
    trackedFiles.filter((path) => /^\.env(?:\.|$)/.test(path)),
    ['.env.example'],
  );
});

test('handoff uses the runtime environment variable names and precise privacy language', () => {
  const handoff = read('docs/RECOVERY_HANDOFF_2026-07-10.md');
  const security = read('docs/SECURITY.md');
  assert.match(handoff, /DASHBOARD_INGEST_TOKEN/);
  assert.match(handoff, /DASHBOARD_VIEW_TOKEN/);
  assert.doesNotMatch(handoff, /USAGE_INGEST_TOKEN|DASHBOARD_VIEW_KEY/);
  assert.doesNotMatch(security, /collector never reads .*prompts.*transcripts/i);
  assert.match(security, /status-line JSON/i);
  assert.match(security, /does not persist or upload/i);
});

test('Kindle runtime fallbacks use one generic placeholder URL', () => {
  const env = read('kindle-extension/local/env.sh');
  const fetch = read('kindle-extension/local/fetch-dashboard.sh');
  const envUrl = env.match(/DASHBOARD_URL=.*?"([^"]+)"/)?.[1];
  const fetchUrl = fetch.match(/DASHBOARD_URL:-"([^"]+)"/)?.[1];
  assert.ok(envUrl?.includes('your-project.vercel.app'));
  assert.equal(fetchUrl, envUrl);
});

test('environment example covers private live mode and dual-window fallback', () => {
  const env = read('.env.example');
  for (const name of [
    'BLOB_READ_WRITE_TOKEN', 'DASHBOARD_INGEST_TOKEN', 'DASHBOARD_VIEW_TOKEN',
    'CLAUDE_FIVE_HOUR_REMAINING', 'CLAUDE_FIVE_HOUR_RESET_LABEL',
    'CLAUDE_SEVEN_DAY_REMAINING', 'CLAUDE_SEVEN_DAY_RESET_LABEL',
    'OPENAI_FIVE_HOUR_REMAINING', 'OPENAI_FIVE_HOUR_RESET_LABEL',
    'OPENAI_SEVEN_DAY_REMAINING', 'OPENAI_SEVEN_DAY_RESET_LABEL',
  ]) assert.match(env, new RegExp(`^${name}=`, 'm'), name);
});

test('README links setup, security, architecture, collector, RTC, and preview', () => {
  const readme = read('README.md');
  const windowsCollector = read('docs/WINDOWS-COLLECTOR.md');
  for (const link of [
    'docs/VERCEL-SETUP.md', 'docs/WINDOWS-COLLECTOR.md', 'docs/SECURITY.md',
    'docs/ARCHITECTURE.md', 'docs/superpowers/specs/2026-07-10-kindle-battery-low-power-design.md',
    'docs/images/dashboard-dp75sdi.png',
  ]) assert.ok(readme.includes(link), link);
  assert.match(readme, /actions\/workflows\/ci\.yml\/badge\.svg/);
  assert.match(readme, /Kindle LLM Quota Uploader-<GUID>/);
  assert.match(windowsCollector, /manifest-owned GUID task/);
  assert.ok(existsSync(new URL('../docs/images/dashboard-dp75sdi.png', import.meta.url)));
});
