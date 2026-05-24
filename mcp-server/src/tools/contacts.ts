import { z } from 'zod';
import { buildQuery } from '../amocrm/connector.js';
import { accountIdField, resolveAccountId, safeHandler, type ToolRegistrar } from './helpers.js';

export const registerContactsTools: ToolRegistrar = (server, ctx) => {
  server.tool(
    'amocrm_get_contact',
    'Fetch a single contact by id, optionally expanding linked leads, customers, catalog elements.',
    {
      ...accountIdField,
      id: z.number().int().positive(),
      with: z.array(z.enum(['leads', 'customers', 'catalog_elements'])).optional(),
    },
    safeHandler(async ({ account_id, id, with: withFields }) => {
      const accountId = resolveAccountId(ctx, account_id);
      const qs = withFields?.length ? `?with=${withFields.join(',')}` : '';
      return ctx.connector.request(accountId, 'GET', `/contacts/${id}${qs}`);
    }),
  );

  server.tool(
    'amocrm_search_contacts',
    'Search contacts by name/phone/email or filter by responsible user.',
    {
      ...accountIdField,
      query: z.string().optional().describe('Full-text search across contact fields'),
      filter: z
        .object({
          responsible_user_id: z.union([z.number(), z.array(z.number())]).optional(),
          id: z.array(z.number()).optional(),
        })
        .partial()
        .optional(),
      with: z.array(z.enum(['leads', 'customers'])).optional(),
      limit: z.number().int().min(1).max(250).default(50),
      page: z.number().int().min(1).default(1),
    },
    safeHandler(async ({ account_id, ...params }) => {
      const accountId = resolveAccountId(ctx, account_id);
      return ctx.connector.request(accountId, 'GET', `/contacts${buildQuery(params)}`);
    }),
  );

  server.tool(
    'amocrm_update_contact',
    'Update a single contact. Pass the patch fields (name, custom_fields_values, responsible_user_id, etc.).',
    {
      ...accountIdField,
      contact_id: z.number().int().positive(),
      patch: z.record(z.unknown()),
    },
    safeHandler(async ({ account_id, contact_id, patch }) => {
      const accountId = resolveAccountId(ctx, account_id);
      return ctx.connector.request(accountId, 'PATCH', '/contacts', [{ ...patch, id: contact_id }]);
    }),
  );

  server.tool(
    'amocrm_create_contact',
    'Create one or more contacts.',
    {
      ...accountIdField,
      contacts: z.array(z.record(z.unknown())).min(1).max(50),
    },
    safeHandler(async ({ account_id, contacts }) => {
      const accountId = resolveAccountId(ctx, account_id);
      return ctx.connector.request(accountId, 'POST', '/contacts', contacts);
    }),
  );
};
