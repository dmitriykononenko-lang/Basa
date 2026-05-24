import { z } from 'zod';
import { buildQuery } from '../amocrm/connector.js';
import { accountIdField, resolveAccountId, safeHandler, type ToolRegistrar } from './helpers.js';

export const registerCompaniesTools: ToolRegistrar = (server, ctx) => {
  server.tool(
    'amocrm_get_company',
    'Fetch a single company by id.',
    {
      ...accountIdField,
      id: z.number().int().positive(),
      with: z.array(z.enum(['leads', 'customers', 'contacts', 'catalog_elements'])).optional(),
    },
    safeHandler(async ({ account_id, id, with: withFields }) => {
      const accountId = resolveAccountId(ctx, account_id);
      const qs = withFields?.length ? `?with=${withFields.join(',')}` : '';
      return ctx.connector.request(accountId, 'GET', `/companies/${id}${qs}`);
    }),
  );

  server.tool(
    'amocrm_list_companies',
    'List companies with filters.',
    {
      ...accountIdField,
      query: z.string().optional(),
      filter: z
        .object({
          responsible_user_id: z.union([z.number(), z.array(z.number())]).optional(),
          id: z.array(z.number()).optional(),
        })
        .partial()
        .optional(),
      limit: z.number().int().min(1).max(250).default(50),
      page: z.number().int().min(1).default(1),
    },
    safeHandler(async ({ account_id, ...params }) => {
      const accountId = resolveAccountId(ctx, account_id);
      return ctx.connector.request(accountId, 'GET', `/companies${buildQuery(params)}`);
    }),
  );

  server.tool(
    'amocrm_create_company',
    'Create one or more companies.',
    {
      ...accountIdField,
      companies: z.array(z.record(z.unknown())).min(1).max(50),
    },
    safeHandler(async ({ account_id, companies }) => {
      const accountId = resolveAccountId(ctx, account_id);
      return ctx.connector.request(accountId, 'POST', '/companies', companies);
    }),
  );

  server.tool(
    'amocrm_update_company',
    'Update a single company.',
    {
      ...accountIdField,
      company_id: z.number().int().positive(),
      patch: z.record(z.unknown()),
    },
    safeHandler(async ({ account_id, company_id, patch }) => {
      const accountId = resolveAccountId(ctx, account_id);
      return ctx.connector.request(accountId, 'PATCH', '/companies', [{ ...patch, id: company_id }]);
    }),
  );
};
