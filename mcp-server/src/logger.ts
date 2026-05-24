import type { ConnectorLogger } from './amocrm/connector.js';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof LEVELS;

export function createLogger(minLevel: Level = 'info'): ConnectorLogger {
  const min = LEVELS[minLevel];
  const emit = (level: Level, message: string, ctx?: Record<string, unknown>): void => {
    if (LEVELS[level] < min) return;
    const line = {
      ts: new Date().toISOString(),
      level,
      message,
      ...(ctx ?? {}),
    };
    // stderr keeps the response stream clean
    process.stderr.write(JSON.stringify(line) + '\n');
  };
  return {
    debug: (m, c) => emit('debug', m, c),
    info: (m, c) => emit('info', m, c),
    warn: (m, c) => emit('warn', m, c),
    error: (m, c) => emit('error', m, c),
  };
}
