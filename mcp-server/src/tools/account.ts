import { z } from 'zod';
import { accountIdField, resolveAccountId, safeHandler, type ToolRegistrar } from './helpers.js';

export const registerAccountTools: ToolRegistrar = (server, ctx) => {
  server.tool(
    'amocrm_account_info',
    'Get information about the connected AmoCRM account (id, name, subdomain, current user, currency, etc.).',
    {
      ...accountIdField,
      with: z
        .array(z.enum(['amojo_id', 'users_groups', 'task_types', 'version', 'datetime_settings']))
        .optional()
        .describe('Optional expand fields supported by GET /api/v4/account'),
    },
    safeHandler(async ({ account_id, with: withFields }) => {
      const accountId = resolveAccountId(ctx, account_id);
      const query = withFields?.length ? `?with=${withFields.join(',')}` : '';
      return ctx.connector.request(accountId, 'GET', `/account${query}`);
    }),
  );
};
