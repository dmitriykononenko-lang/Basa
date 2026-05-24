import { promises as fs } from 'node:fs';
import path from 'node:path';
import { AmoCrmError } from './errors.js';
import type { StoredToken } from './types.js';

export interface TokenStorage {
  load(accountId: string): Promise<StoredToken | null>;
  save(accountId: string, data: StoredToken): Promise<void>;
  delete(accountId: string): Promise<void>;
}

/**
 * File-backed token storage that is binary-compatible with the PHP
 * FileTokenStorage used by the AmoCRM widget backend.
 *
 * Layout: `${baseDir}/${safeAccountId}.json`
 * Writes are atomic via `rename` from a sibling temp file to avoid torn reads.
 */
export class FileTokenStorage implements TokenStorage {
  constructor(private readonly directory: string) {}

  async load(accountId: string): Promise<StoredToken | null> {
    const file = this.pathFor(accountId);
    try {
      const contents = await fs.readFile(file, 'utf8');
      if (!contents) return null;
      return JSON.parse(contents) as StoredToken;
    } catch (err: unknown) {
      if (isFsNotFound(err)) return null;
      throw err;
    }
  }

  async save(accountId: string, data: StoredToken): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o755 });
    const file = this.pathFor(accountId);
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    await fs.rename(tmp, file);
  }

  async delete(accountId: string): Promise<void> {
    try {
      await fs.unlink(this.pathFor(accountId));
    } catch (err: unknown) {
      if (!isFsNotFound(err)) throw err;
    }
  }

  private pathFor(accountId: string): string {
    const safe = accountId.replace(/[^A-Za-z0-9_-]/g, '_');
    if (!safe) throw new AmoCrmError('Empty or invalid accountId');
    return path.join(this.directory, `${safe}.json`);
  }
}

function isFsNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}
