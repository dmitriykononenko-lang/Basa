import path from 'node:path';
import type { OAuthConfig } from './amocrm/types.js';

export interface AppConfig {
  port: number;
  host: string;
  storagePath: string;
  tokensDir: string;
  oauth: OAuthConfig;
  defaultAccountId: string | null;
  authToken: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const required = (key: string): string => {
    const val = env[key];
    if (!val) throw new Error(`Missing required env var: ${key}`);
    return val;
  };

  const storagePath = env.STORAGE_PATH ?? '/var/lib/amocrm';
  const tokensDir = path.join(storagePath, 'tokens');

  return {
    port: Number(env.PORT ?? 3001),
    host: env.HOST ?? '0.0.0.0',
    storagePath,
    tokensDir,
    oauth: {
      clientId: required('AMO_CLIENT_ID'),
      clientSecret: required('AMO_CLIENT_SECRET'),
      redirectUri: required('AMO_REDIRECT_URI'),
    },
    defaultAccountId: env.DEFAULT_ACCOUNT_ID || null,
    authToken: required('MCP_AUTH_TOKEN'),
    logLevel: (env.LOG_LEVEL as AppConfig['logLevel']) ?? 'info',
  };
}
