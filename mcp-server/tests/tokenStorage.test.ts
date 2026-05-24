import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FileTokenStorage } from '../src/amocrm/tokenStorage.js';

describe('FileTokenStorage', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'amocrm-storage-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('save and load roundtrip', async () => {
    const storage = new FileTokenStorage(dir);
    const token = {
      access_token: 'AT',
      refresh_token: 'RT',
      expires_at: 1234,
      token_type: 'Bearer',
      base_domain: 'acme.amocrm.ru',
    };
    await storage.save('42', token);
    expect(await storage.load('42')).toEqual(token);
  });

  it('load returns null for unknown account', async () => {
    expect(await new FileTokenStorage(dir).load('nope')).toBeNull();
  });

  it('delete is idempotent', async () => {
    const storage = new FileTokenStorage(dir);
    await storage.delete('nope'); // no throw
    expect(await storage.load('nope')).toBeNull();
  });

  it('sanitizes account ids to prevent path traversal', async () => {
    const storage = new FileTokenStorage(dir);
    await storage.save('../../etc/passwd', {
      access_token: 'a',
      refresh_token: 'r',
      base_domain: 'x.amocrm.ru',
    });
    const files = await fs.readdir(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).not.toContain('/');
  });

  it('writes atomically (no .tmp file left behind)', async () => {
    const storage = new FileTokenStorage(dir);
    await storage.save('42', {
      access_token: 'a',
      refresh_token: 'r',
      base_domain: 'x.amocrm.ru',
    });
    const files = await fs.readdir(dir);
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
  });
});
