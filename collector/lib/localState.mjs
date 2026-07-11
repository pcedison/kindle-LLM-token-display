import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { statePath, stateRoot } from './paths.mjs';

export { statePath, stateRoot };

async function renameAtomic(fs, source, destination) {
  const attempts = process.platform === 'win32' ? 5 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fs.rename(source, destination);
      return;
    } catch (error) {
      const transient = ['EACCES', 'EBUSY', 'EPERM'].includes(error?.code);
      if (!transient || attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 8 * (attempt + 1)));
    }
  }
}

export async function readJsonState(name) {
  try {
    return JSON.parse(await readFile(statePath(name), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function writeJsonStateAtomic(name, value, {
  fs = { mkdir, open, rename, rm },
  root = stateRoot(),
} = {}) {
  const destination = statePath(name, root);
  await fs.mkdir(dirname(destination), { recursive: true });
  const temporary = join(root, `.${name}.${randomBytes(12).toString('hex')}.tmp`);
  try {
    const file = await fs.open(temporary, 'w');
    try {
      await file.writeFile(JSON.stringify(value), { encoding: 'utf8' });
      await file.sync();
    } finally {
      await file.close();
    }
    await renameAtomic(fs, temporary, destination);
    try {
      const directory = await fs.open(root, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EINVAL', 'EBADF'].includes(error.code)) throw error;
    }
  } finally {
    try { await fs.rm(temporary, { force: true }); } catch {}
  }
}
