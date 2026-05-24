import { z } from 'zod';
import { buildQuery } from '../amocrm/connector.js';
import { accountIdField, resolveAccountId, safeHandler, type ToolRegistrar } from './helpers.js';

export const registerUsersTools: ToolRegistrar = (server, ctx) => {
  server.tool(
    'amocrm_list_users',
    'List all users (managers) of the account, with their roles and groups.',
    {
      ...accountIdField,
      with: z.array(z.enum(['role', 'group', 'uuid'])).optional(),
      limit: z.number().int().min(1).max(250).default(50),
      page: z.number().int().min(1).default(1),
    },
    safeHandler(async ({ account_id, ...params }) => {
      const accountId = resolveAccountId(ctx, account_id);
      return ctx.connector.request(accountId, 'GET', `/users${buildQuery(params)}`);
    }),
  );

  server.tool(
    'amocrm_get_user',
    'Fetch a single user (manager) by id.',
    {
      ...accountIdField,
      id: z.number().int().positive(),
      with: z.array(z.enum(['role', 'group', 'uuid'])).optional(),
    },
    safeHandler(async ({ account_id, id, with: withFields }) => {
      const accountId = resolveAccountId(ctx, account_id);
      const qs = withFields?.length ? `?with=${withFields.join(',')}` : '';
      return ctx.connector.request(accountId, 'GET', `/users/${id}${qs}`);
    }),
  );
};
