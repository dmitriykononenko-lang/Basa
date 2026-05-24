export interface StoredToken {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  saved_at?: number;
  token_type?: string;
  base_domain: string;
}

export interface NormalizedToken {
  accessToken: string;
  refreshToken: string;
  /** Unix seconds */
  expiresAt: number;
  tokenType: string;
  baseDomain: string;
}

export function normalizeStoredToken(data: StoredToken): NormalizedToken {
  let expiresAt = data.expires_at ?? 0;
  if (!expiresAt && data.expires_in && data.saved_at) {
    expiresAt = data.saved_at + data.expires_in;
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
    tokenType: data.token_type ?? 'Bearer',
    baseDomain: data.base_domain,
  };
}

export function denormalizeToken(token: NormalizedToken): StoredToken {
  return {
    access_token: token.accessToken,
    refresh_token: token.refreshToken,
    expires_at: token.expiresAt,
    token_type: token.tokenType,
    base_domain: token.baseDomain,
  };
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}
