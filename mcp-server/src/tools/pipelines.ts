import { z } from 'zod';
import { accountIdField, resolveAccountId, safeHandler, type ToolRegistrar } from './helpers.js';

export const registerPipelinesTools: ToolRegistrar = (server, ctx) => {
  server.tool(
    'amocrm_list_pipelines',
    'List all sales pipelines defined for the account, including their statuses (stages).',
    accountIdField,
    safeHandler(async ({ account_id }) => {
      const accountId = resolveAccountId(ctx, account_id);
      return ctx.connector.request(accountId, 'GET', '/leads/pipelines');
    }),
  );

  server.tool(
    'amocrm_get_pipeline',
    'Fetch a single pipeline with its statuses.',
    {
      ...accountIdField,
      pipeline_id: z.number().int().positive(),
    },
    safeHandler(async ({ account_id, pipeline_id }) => {
      const accountId = resolveAccountId(ctx, account_id);
      return ctx.connector.request(accountId, 'GET', `/leads/pipelines/${pipeline_id}`);
    }),
  );

  server.tool(
    'amocrm_list_pipeline_statuses',
    'List statuses (stages) of a specific pipeline.',
    {
      ...accountIdField,
      pipeline_id: z.number().int().positive(),
    },
    safeHandler(async ({ account_id, pipeline_id }) => {
      const accountId = resolveAccountId(ctx, account_id);
      return ctx.connector.request(accountId, 'GET', `/leads/pipelines/${pipeline_id}/statuses`);
    }),
  );
};
