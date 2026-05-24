import { z } from 'zod';
import { buildQuery } from '../amocrm/connector.js';
import { accountIdField, resolveAccountId, safeHandler, type ToolRegistrar } from './helpers.js';

const leadWith = z
  .array(z.enum(['contacts', 'companies', 'catalog_elements', 'is_price_modified_by_robot', 'loss_reason', 'only_deleted']))
  .optional();

export const registerLeadsTools: ToolRegistrar = (server, ctx) => {
  server.tool(
    'amocrm_get_lead',
    'Fetch a single lead (deal) by its numeric AmoCRM id, optionally expanding linked contacts/companies.',
    {
      ...accountIdField,
      id: z.number().int().positive(),
      with: leadWith,
    },
    safeHandler(async ({ account_id, id, with: withFields }) => {
      const accountId = resolveAccountId(ctx, account_id);
      const qs = withFields?.length ? `?with=${withFields.join(',')}` : '';
      return ctx.connector.request(accountId, 'GET', `/leads/${id}${qs}`);
    }),
  );

  server.tool(
    'amocrm_list_leads',
    'Search and list leads. Supports filtering by responsible user, pipeline, status, query text, etc.',
    {
      ...accountIdField,
      query: z.string().optional().describe('Full-text search over leads'),
      filter: z
        .object({
          responsible_user_id: z.union([z.number(), z.array(z.number())]).optional(),
          pipeline_id: z.union([z.number(), z.array(z.number())]).optional(),
          status_id: z.union([z.number(), z.array(z.number())]).optional(),
          is_deleted: z.boolean().optional(),
          created_at: z
            .object({ from: z.number().optional(), to: z.number().optional() })
            .optional(),
          updated_at: z
            .object({ from: z.number().optional(), to: z.number().optional() })
            .optional(),
        })
        .partial()
        .optional(),
      with: leadWith,
      order: z
        .object({
          updated_at: z.enum(['asc', 'desc']).optional(),
          created_at: z.enum(['asc', 'desc']).optional(),
          id: z.enum(['asc', 'desc']).optional(),
        })
        .optional(),
      limit: z.number().int().min(1).max(250).default(50),
      page: z.number().int().min(1).default(1),
    },
    safeHandler(async ({ account_id, ...params }) => {
      const accountId = resolveAccountId(ctx, account_id);
      return ctx.connector.request(accountId, 'GET', `/leads${buildQuery(params)}`);
    }),
  );

  server.tool(
    'amocrm_create_lead',
    'Create one or more leads. Pass an array of lead objects (see AmoCRM docs for the schema).',
    {
      ...accountIdField,
      leads: z.array(z.record(z.unknown())).min(1).max(50),
    },
    safeHandler(async ({ account_id, leads }) => {
      const accountId = resolveAccountId(ctx, account_id);
      return ctx.connector.request(accountId, 'POST', '/leads', leads);
    }),
  );

  server.tool(
    'amocrm_update_lead_responsible',
    'Reassign a lead to a different manager by setting responsible_user_id.',
    {
      ...accountIdField,
      lead_id: z.number().int().positive(),
      responsible_user_id: z.number().int().positive(),
    },
    safeHandler(async ({ account_id, lead_id, responsible_user_id }) => {
      const accountId = resolveAccountId(ctx, account_id);
      return ctx.connector.request(accountId, 'PATCH', '/leads', [
        { id: lead_id, responsible_user_id },
      ]);
    }),
  );

  server.tool(
    'amocrm_update_lead_status',
    'Move a lead to a different stage. Optionally also moves it to another pipeline.',
    {
      ...accountIdField,
      lead_id: z.number().int().positive(),
      status_id: z.number().int().positive(),
      pipeline_id: z.number().int().positive().optional(),
    },
    safeHandler(async ({ account_id, lead_id, status_id, pipeline_id }) => {
      const accountId = resolveAccountId(ctx, account_id);
      const patch: Record<string, unknown> = { id: lead_id, status_id };
      if (pipeline_id) patch.pipeline_id = pipeline_id;
      return ctx.connector.request(accountId, 'PATCH', '/leads', [patch]);
    }),
  );

  server.tool(
    'amocrm_update_lead',
    'Generic lead update — pass the fields you want to change (name, price, custom_fields_values, tags, etc.).',
    {
      ...accountIdField,
      lead_id: z.number().int().positive(),
      patch: z.record(z.unknown()).describe('Fields to update'),
    },
    safeHandler(async ({ account_id, lead_id, patch }) => {
      const accountId = resolveAccountId(ctx, account_id);
      return ctx.connector.request(accountId, 'PATCH', '/leads', [{ ...patch, id: lead_id }]);
    }),
  );
};
