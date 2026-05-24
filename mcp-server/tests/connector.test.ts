import { describe, expect, it, vi } from 'vitest';
import { Connector, buildQuery, type FetchLike } from '../src/amocrm/connector.js';
import { AmoCrmError } from '../src/amocrm/errors.js';
import type { StoredToken } from '../src/amocrm/types.js';
import type { TokenStorage } from '../src/amocrm/tokenStorage.js';

class InMemoryStorage implements TokenStorage {
  private readonly map = new Map<string, StoredToken>();
  async load(accountId: string): Promise<StoredToken | null> {
    return this.map.get(accountId) ?? null;
  }
  async save(accountId: string, data: StoredToken): Promise<void> {
    this.map.set(accountId, data);
  }
  async delete(accountId: string): Promise<void> {
    this.map.delete(accountId);
  }
}

interface MockCall {
  url: string;
  init: RequestInit | undefined;
}

function mockFetch(responses: Array<Response | (() => Response)>): {
  fetch: FetchLike;
  calls: MockCall[];
} {
  const calls: MockCall[] = [];
  let i = 0;
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const next = responses[i++];
    if (!next) throw new Error(`mockFetch: unexpected request #${i} to ${url}`);
    return typeof next === 'function' ? next() : next;
  };
  return { fetch: fetchFn, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function freshToken(opts: Partial<StoredToken> = {}): StoredToken {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: 'AT',
    refresh_token: 'RT',
    expires_at: now + 3600,
    token_type: 'Bearer',
    base_domain: 'acme.amocrm.ru',
    ...opts,
  };
}

function makeConnector(storage: TokenStorage, fetchFn: FetchLike) {
  return new Connector({
    oauth: { clientId: 'cid', clientSecret: 'csec', redirectUri: 'https://app/cb' },
    storage,
    fetch: fetchFn,
  });
}

describe('Connector.request', () => {
  it('attaches bearer header and hits the AmoCRM API URL', async () => {
    const storage = new InMemoryStorage();
    await storage.save('acc', freshToken());
    const { fetch, calls } = mockFetch([jsonResponse({ id: 42 })]);

    const conn = makeConnector(storage, fetch);
    const result = await conn.request('acc', 'GET', '/leads/42?with=contacts');

    expect(result).toEqual({ id: 42 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://acme.amocrm.ru/api/v4/leads/42?with=contacts');
    expect(calls[0]!.init?.method).toBe('GET');
    const headers = (calls[0]!.init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer AT');
    expect(headers.Accept).toBe('application/json');
  });

  it('refreshes token on 401 and retries the request', async () => {
    const storage = new InMemoryStorage();
    await storage.save('acc', freshToken({ access_token: 'OLD', refresh_token: 'OLD_R' }));

    const { fetch, calls } = mockFetch([
      // 1) original request → 401
      jsonResponse({ detail: 'expired' }, 401),
      // 2) refresh token endpoint
      jsonResponse({
        access_token: 'NEW',
        refresh_token: 'NEW_R',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
      // 3) retried request
      jsonResponse({ ok: true }),
    ]);

    const conn = makeConnector(storage, fetch);
    const result = await conn.request('acc', 'GET', '/leads/42');

    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(3);
    expect(calls[1]!.url).toBe('https://acme.amocrm.ru/oauth2/access_token');

    const refreshBody = JSON.parse(calls[1]!.init!.body as string);
    expect(refreshBody.grant_type).toBe('refresh_token');
    expect(refreshBody.refresh_token).toBe('OLD_R');
    expect(refreshBody.client_id).toBe('cid');

    const retryHeaders = (calls[2]!.init?.headers ?? {}) as Record<string, string>;
    expect(retryHeaders.Authorization).toBe('Bearer NEW');

    const stored = await storage.load('acc');
    expect(stored?.access_token).toBe('NEW');
    expect(stored?.refresh_token).toBe('NEW_R');
  });

  it('refreshes proactively when token is within the refresh skew', async () => {
    const storage = new InMemoryStorage();
    const now = Math.floor(Date.now() / 1000);
    // expires in 10s — well within the default 60s skew
    await storage.save('acc', freshToken({ expires_at: now + 10 }));

    const { fetch, calls } = mockFetch([
      // proactive refresh — no failing attempt first
      jsonResponse({
        access_token: 'NEW',
        refresh_token: 'NEW_R',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
      jsonResponse({ ok: true }),
    ]);

    const conn = makeConnector(storage, fetch);
    await conn.request('acc', 'GET', '/leads');

    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe('https://acme.amocrm.ru/oauth2/access_token');
    const apiHeaders = (calls[1]!.init?.headers ?? {}) as Record<string, string>;
    expect(apiHeaders.Authorization).toBe('Bearer NEW');
  });

  it('throws AmoCrmError on 4xx', async () => {
    const storage = new InMemoryStorage();
    await storage.save('acc', freshToken());
    const { fetch } = mockFetch([jsonResponse({ error: 'not found' }, 404)]);

    const conn = makeConnector(storage, fetch);
    await expect(conn.request('acc', 'GET', '/leads/999')).rejects.toMatchObject({
      name: 'AmoCrmError',
      status: 404,
    });
  });

  it('throws AmoCrmError on 5xx', async () => {
    const storage = new InMemoryStorage();
    await storage.save('acc', freshToken());
    const { fetch } = mockFetch([new Response('upstream down', { status: 503 })]);

    const conn = makeConnector(storage, fetch);
    await expect(conn.request('acc', 'GET', '/leads')).rejects.toMatchObject({
      name: 'AmoCrmError',
      status: 503,
    });
  });

  it('fails when no token is stored', async () => {
    const storage = new InMemoryStorage();
    const { fetch } = mockFetch([]);
    const conn = makeConnector(storage, fetch);

    await expect(conn.request('missing', 'GET', '/leads')).rejects.toThrow(/No tokens stored/);
  });

  it('coalesces concurrent refreshes', async () => {
    const storage = new InMemoryStorage();
    const now = Math.floor(Date.now() / 1000);
    await storage.save('acc', freshToken({ expires_at: now - 5 })); // already expired

    // Both calls will need to refresh — but should share one refresh in flight
    const { fetch, calls } = mockFetch([
      jsonResponse({
        access_token: 'NEW',
        refresh_token: 'NEW_R',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
      jsonResponse({ ok: 1 }),
      jsonResponse({ ok: 2 }),
    ]);

    const conn = makeConnector(storage, fetch);
    const [a, b] = await Promise.all([
      conn.request('acc', 'GET', '/leads/1'),
      conn.request('acc', 'GET', '/leads/2'),
    ]);

    expect(a).toEqual({ ok: 1 });
    expect(b).toEqual({ ok: 2 });
    // 1 refresh + 2 API calls = 3 fetches total (not 4)
    expect(calls).toHaveLength(3);
    expect(calls[0]!.url).toContain('/oauth2/access_token');
  });

  it('returns empty object on 204', async () => {
    const storage = new InMemoryStorage();
    await storage.save('acc', freshToken());
    const { fetch } = mockFetch([new Response(null, { status: 204 })]);

    const conn = makeConnector(storage, fetch);
    await expect(conn.request('acc', 'DELETE', '/leads/1')).resolves.toEqual({});
  });

  it('serializes JSON body for POST/PATCH', async () => {
    const storage = new InMemoryStorage();
    await storage.save('acc', freshToken());
    const { fetch, calls } = mockFetch([jsonResponse({})]);

    const conn = makeConnector(storage, fetch);
    await conn.request('acc', 'PATCH', '/leads', [{ id: 1, responsible_user_id: 7 }]);

    expect(calls[0]!.init?.method).toBe('PATCH');
    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual([
      { id: 1, responsible_user_id: 7 },
    ]);
    const headers = (calls[0]!.init?.headers ?? {}) as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
  });
});

describe('Connector.paginate', () => {
  it('walks _links.next until done', async () => {
    const storage = new InMemoryStorage();
    await storage.save('acc', freshToken());

    const { fetch, calls } = mockFetch([
      jsonResponse({
        _embedded: { leads: [{ id: 1 }, { id: 2 }] },
        _links: { next: { href: 'https://acme.amocrm.ru/api/v4/leads?page=2' } },
      }),
      jsonResponse({
        _embedded: { leads: [{ id: 3 }] },
        _links: {},
      }),
    ]);

    const conn = makeConnector(storage, fetch);
    const ids: number[] = [];
    for await (const lead of conn.paginate<{ id: number }>('acc', '/leads', 'leads', {
      filter: { responsible_user_id: 7 },
      limit: 2,
    })) {
      ids.push(lead.id);
    }

    expect(ids).toEqual([1, 2, 3]);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toContain('page=1');
    expect(calls[1]!.url).toContain('page=2');
  });
});

describe('buildQuery', () => {
  it('flattens nested filter and order', () => {
    const qs = buildQuery({
      filter: {
        responsible_user_id: 7,
        statuses: [1, 2],
      },
      order: { updated_at: 'desc' },
      with: ['contacts', 'companies'],
      limit: 50,
    });
    const parsed = new URLSearchParams(qs.slice(1));

    expect(parsed.get('filter[responsible_user_id]')).toBe('7');
    expect(parsed.get('filter[statuses][0]')).toBe('1');
    expect(parsed.get('filter[statuses][1]')).toBe('2');
    expect(parsed.get('order[updated_at]')).toBe('desc');
    expect(parsed.get('with')).toBe('contacts,companies');
    expect(parsed.get('limit')).toBe('50');
  });

  it('returns empty string for empty params', () => {
    expect(buildQuery({})).toBe('');
  });
});

describe('AmoCrmError', () => {
  it('exposes status code', () => {
    const err = new AmoCrmError('boom', 503, 'oops');
    expect(err.status).toBe(503);
    expect(err.bodySnippet).toBe('oops');
    expect(err.name).toBe('AmoCrmError');
  });

  // Sanity check that vi is wired up — keeps this file's vitest import non-dead
  it('vi mocking is available', () => {
    const fn = vi.fn(() => 42);
    expect(fn()).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
