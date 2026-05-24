import { z } from 'zod';
import { accountIdField, resolveAccountId, safeHandler, type ToolRegistrar } from './helpers.js';

const entityType = z.enum(['leads', 'contacts', 'companies', 'customers']);

export const registerNotesTools: ToolRegistrar = (server, ctx) => {
  server.tool(
    'amocrm_add_note',
    'Add a free-text note (note_type=common) to a lead, contact, company or customer.',
    {
      ...accountIdField,
      entity_type: entityType,
      entity_id: z.number().int().positive(),
      text: z.string().min(1),
    },
    safeHandler(async ({ account_id, entity_type, entity_id, text }) => {
      const accountId = resolveAccountId(ctx, account_id);
      return ctx.connector.request(accountId, 'POST', `/${entity_type}/${entity_id}/notes`, [
        { note_type: 'common', params: { text } },
      ]);
    }),
  );

  server.tool(
    'amocrm_list_notes',
    'List notes attached to an entity (lead/contact/company/customer).',
    {
      ...accountIdField,
      entity_type: entityType,
      entity_id: z.number().int().positive(),
      limit: z.number().int().min(1).max(250).default(50),
      page: z.number().int().min(1).default(1),
    },
    safeHandler(async ({ account_id, entity_type, entity_id, limit, page }) => {
      const accountId = resolveAccountId(ctx, account_id);
      return ctx.connector.request(
        accountId,
        'GET',
        `/${entity_type}/${entity_id}/notes?limit=${limit}&page=${page}`,
      );
    }),
  );
};
