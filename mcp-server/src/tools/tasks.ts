import { z } from 'zod';
import { buildQuery } from '../amocrm/connector.js';
import { accountIdField, resolveAccountId, safeHandler, type ToolRegistrar } from './helpers.js';

export const registerTasksTools: ToolRegistrar = (server, ctx) => {
  server.tool(
    'amocrm_create_task',
    'Create a task. entity_type is one of leads/contacts/companies/customers. complete_till is a Unix timestamp.',
    {
      ...accountIdField,
      entity_type: z.enum(['leads', 'contacts', 'companies', 'customers']).optional(),
      entity_id: z.number().int().positive().optional(),
      text: z.string().min(1),
      complete_till: z
        .number()
        .int()
        .positive()
        .describe('Unix seconds — when the task should be completed by'),
      responsible_user_id: z.number().int().positive().optional(),
      task_type_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('AmoCRM task type id (1=call, 2=meeting, 3=email by default)'),
    },
    safeHandler(async ({ account_id, entity_type, entity_id, ...rest }) => {
      const accountId = resolveAccountId(ctx, account_id);
      const task: Record<string, unknown> = { ...rest };
      if (entity_type) task.entity_type = entity_type;
      if (entity_id) task.entity_id = entity_id;
      return ctx.connector.request(accountId, 'POST', '/tasks', [task]);
    }),
  );

  server.tool(
    'amocrm_list_tasks',
    'List tasks with filters.',
    {
      ...accountIdField,
      filter: z
        .object({
          responsible_user_id: z.union([z.number(), z.array(z.number())]).optional(),
          is_completed: z.boolean().optional(),
          entity_type: z.enum(['leads', 'contacts', 'companies', 'customers']).optional(),
          entity_id: z.number().optional(),
        })
        .partial()
        .optional(),
      limit: z.number().int().min(1).max(250).default(50),
      page: z.number().int().min(1).default(1),
    },
    safeHandler(async ({ account_id, ...params }) => {
      const accountId = resolveAccountId(ctx, account_id);
      return ctx.connector.request(accountId, 'GET', `/tasks${buildQuery(params)}`);
    }),
  );

  server.tool(
    'amocrm_complete_task',
    'Mark a task as completed, optionally with a result text.',
    {
      ...accountIdField,
      task_id: z.number().int().positive(),
      result: z.string().optional().default(''),
    },
    safeHandler(async ({ account_id, task_id, result }) => {
      const accountId = resolveAccountId(ctx, account_id);
      return ctx.connector.request(accountId, 'PATCH', '/tasks', [
        { id: task_id, is_completed: true, result: { text: result } },
      ]);
    }),
  );
};
