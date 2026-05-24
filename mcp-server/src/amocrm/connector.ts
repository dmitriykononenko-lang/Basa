import { AmoCrmError } from './errors.js';
import {
  denormalizeToken,
  normalizeStoredToken,
  type NormalizedToken,
  type OAuthConfig,
} from './types.js';
import type { TokenStorage } from './tokenStorage.js';

const API_BASE_PATH = '/api/v4';
const TOKEN_REFRESH_SKEW_SECONDS = 60;
const OAUTH_TOKEN_PATH = '/oauth2/access_token';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ConnectorLogger {
  debug?(msg: string, ctx?: Record<string, unknown>): void;
  info?(msg: string, ctx?: Record<string, unknown>): void;
  warn?(msg: string, ctx?: Record<string, unknown>): void;
  error?(msg: string, ctx?: Record<string, unknown>): void;
}

export interface ConnectorOptions {
  oauth: OAuthConfig;
  storage: TokenStorage;
  fetch?: FetchLike;
  logger?: ConnectorLogger;
  /** Refresh tokens when they expire within this many seconds. Default 60. */
  refreshSkewSeconds?: number;
}

/**
 * Stateful AmoCRM REST API v4 client.
 *
 * Tokens are loaded from a shared storage (same format as the PHP backend).
 * The connector:
 *  - attaches the bearer token,
 *  - refreshes proactively when the token is near expiry,
 *  - retries once after a 401 by refreshing.
 *
 * It does NOT perform the initial OAuth handshake — that's done by the PHP
 * backend's /oauth/callback endpoint. The MCP server is read-only from
 * the OAuth perspective: it consumes tokens, refreshes them when needed,
 * and writes the refreshed pair back to the shared storage.
 */
export class Connector {
  private readonly fetch: FetchLike;
  private readonly logger: ConnectorLogger;
  private readonly refreshSkew: number;
  /** In-flight refresh promises keyed by accountId to coalesce concurrent refreshes within this process. */
  private readonly inflightRefreshes = new Map<string, Promise<NormalizedToken>>();

  constructor(private readonly options: ConnectorOptions) {
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.logger = options.logger ?? {};
    this.refreshSkew = options.refreshSkewSeconds ?? TOKEN_REFRESH_SKEW_SECONDS;
  }

  async getToken(accountId: string): Promise<NormalizedToken | null> {
    const stored = await this.options.storage.load(accountId);
    return stored ? normalizeStoredToken(stored) : null;
  }

  async isConnected(accountId: string): Promise<boolean> {
    return (await this.options.storage.load(accountId)) !== null;
  }

  async refreshAccessToken(accountId: string): Promise<NormalizedToken> {
    const existing = this.inflightRefreshes.get(accountId);
    if (existing) return existing;

    const promise = (async () => {
      const current = await this.getToken(accountId);
      if (!current) {
        throw new AmoCrmError(`No tokens stored for account ${accountId}`);
      }

      const response = await this.postOAuthTokenEndpoint(current.baseDomain, {
        grant_type: 'refresh_token',
        refresh_token: current.refreshToken,
      });

      const issuedAt = Math.floor(Date.now() / 1000);
      const expiresIn = typeof response.expires_in === 'number' ? response.expires_in : 86400;

      const token: NormalizedToken = {
        accessToken: String(response.access_token),
        refreshToken: String(response.refresh_token),
        expiresAt: issuedAt + expiresIn,
        tokenType: String(response.token_type ?? 'Bearer'),
        baseDomain: current.baseDomain,
      };

      await this.options.storage.save(accountId, denormalizeToken(token));
      this.logger.info?.('Refreshed AmoCRM tokens', { accountId });
      return token;
    })().finally(() => {
      this.inflightRefreshes.delete(accountId);
    });

    this.inflightRefreshes.set(accountId, promise);
    return promise;
  }

  /**
   * Perform an authenticated request and return the JSON-decoded body
   * (or empty object for 204/no-content responses).
   */
  async request<T = Record<string, unknown>>(
    accountId: string,
    method: string,
    pathWithQuery: string,
    body?: unknown,
  ): Promise<T> {
    let token = await this.getToken(accountId);
    if (!token) {
      throw new AmoCrmError(`No tokens stored for account ${accountId}`);
    }

    if (this.isExpired(token, this.refreshSkew)) {
      token = await this.refreshAccessToken(accountId);
    }

    const url = `https://${token.baseDomain}${API_BASE_PATH}${pathWithQuery}`;

    let response = await this.send(url, method, body, token.accessToken);

    if (response.status === 401) {
      token = await this.refreshAccessToken(accountId);
      response = await this.send(url, method, body, token.accessToken);
    }

    if (!response.ok) {
      const snippet = await safeReadBody(response, 500);
      throw new AmoCrmError(
        `AmoCRM API error (HTTP ${response.status}) ${method} ${pathWithQuery}` +
          (snippet ? ` — ${snippet}` : ''),
        response.status,
        snippet,
      );
    }

    if (response.status === 204) return {} as T;

    const text = await response.text();
    if (!text) return {} as T;

    try {
      return JSON.parse(text) as T;
    } catch (err) {
      throw new AmoCrmError(
        `AmoCRM returned non-JSON body for ${method} ${pathWithQuery}: ${(err as Error).message}`,
        response.status,
      );
    }
  }

  /**
   * Convenience: walk a paginated list endpoint.
   * Yields embedded items page by page until `_links.next` is absent.
   */
  async *paginate<T = Record<string, unknown>>(
    accountId: string,
    basePath: string,
    embeddedKey: string,
    initialQuery: Record<string, unknown> = {},
    maxItems = 1000,
  ): AsyncIterable<T> {
    const query: Record<string, unknown> = {
      limit: 250,
      page: 1,
      ...initialQuery,
    };

    let emitted = 0;
    while (emitted < maxItems) {
      const qs = buildQuery(query);
      const page = await this.request<{
        _embedded?: Record<string, T[]>;
        _links?: { next?: { href?: string } };
      }>(accountId, 'GET', `${basePath}${qs}`);

      const items = page._embedded?.[embeddedKey] ?? [];
      for (const item of items) {
        if (emitted >= maxItems) return;
        yield item;
        emitted++;
      }

      const limit = Number(query.limit);
      if (!page._links?.next?.href || items.length < limit) return;
      query.page = Number(query.page) + 1;
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private async send(
    url: string,
    method: string,
    body: unknown,
    accessToken: string,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    try {
      return await this.fetch(url, init);
    } catch (err) {
      throw new AmoCrmError(`AmoCRM network error: ${(err as Error).message}`);
    }
  }

  private async postOAuthTokenEndpoint(
    baseDomain: string,
    grantPayload: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const payload = {
      ...grantPayload,
      client_id: this.options.oauth.clientId,
      client_secret: this.options.oauth.clientSecret,
      redirect_uri: this.options.oauth.redirectUri,
    };
    const url = `https://${baseDomain}${OAUTH_TOKEN_PATH}`;

    let response: Response;
    try {
      response = await this.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      throw new AmoCrmError(`AmoCRM token endpoint network error: ${(err as Error).message}`);
    }

    if (!response.ok) {
      const snippet = await safeReadBody(response, 500);
      throw new AmoCrmError(
        `AmoCRM token endpoint returned HTTP ${response.status}${snippet ? ` — ${snippet}` : ''}`,
        response.status,
        snippet,
      );
    }
    const text = await response.text();
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch (err) {
      throw new AmoCrmError(`Invalid JSON from token endpoint: ${(err as Error).message}`);
    }
  }

  private isExpired(token: NormalizedToken, skew: number): boolean {
    return token.expiresAt - skew <= Math.floor(Date.now() / 1000);
  }
}

async function safeReadBody(response: Response, maxLength: number): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, maxLength);
  } catch {
    return '';
  }
}

/** Build a query string from a params object, with structured filter[] / order[] support. */
export function buildQuery(params: Record<string, unknown>): string {
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (key === 'with' && Array.isArray(value)) {
      entries.push(['with', value.join(',')]);
      continue;
    }
    if ((key === 'filter' || key === 'order') && typeof value === 'object' && !Array.isArray(value)) {
      for (const [subKey, subVal] of Object.entries(value as Record<string, unknown>)) {
        if (Array.isArray(subVal)) {
          subVal.forEach((v, i) => entries.push([`${key}[${subKey}][${i}]`, String(v)]));
        } else if (subVal !== undefined && subVal !== null) {
          entries.push([`${key}[${subKey}]`, String(subVal)]);
        }
      }
      continue;
    }
    entries.push([key, String(value)]);
  }
  if (entries.length === 0) return '';
  const search = new URLSearchParams(entries).toString();
  return `?${search}`;
}
