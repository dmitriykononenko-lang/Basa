import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Connector } from '../amocrm/connector.js';
import { AmoCrmError } from '../amocrm/errors.js';

export interface ToolContext {
  connector: Connector;
  defaultAccountId: string | null;
}

/** Common AccountId field added to every tool's input schema. */
export const accountIdField = {
  account_id: z
    .string()
    .min(1)
    .optional()
    .describe('AmoCRM account id. Optional if DEFAULT_ACCOUNT_ID is set on the server.'),
};

export function resolveAccountId(ctx: ToolContext, accountId?: string): string {
  const resolved = accountId ?? ctx.defaultAccountId;
  if (!resolved) {
    throw new Error(
      'No account_id provided and DEFAULT_ACCOUNT_ID is not set. ' +
        'Pass account_id explicitly or configure the server default.',
    );
  }
  return resolved;
}

export type ToolHandlerResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

/**
 * Wrap a tool handler so AmoCrmError and unexpected errors are returned
 * as `isError: true` MCP responses instead of throwing — Claude needs to
 * see the message to decide what to do next.
 */
export function safeHandler<T>(
  handler: (args: T) => Promise<unknown>,
): (args: T) => Promise<ToolHandlerResult> {
  return async (args: T) => {
    try {
      const result = await handler(args);
      return {
        content: [
          {
            type: 'text' as const,
            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      const message =
        err instanceof AmoCrmError
          ? `AmoCRM error (HTTP ${err.status}): ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      return {
        content: [{ type: 'text' as const, text: message }],
        isError: true,
      };
    }
  };
}

export type ToolRegistrar = (server: McpServer, ctx: ToolContext) => void;
