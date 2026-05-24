import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAccountTools } from './account.js';
import { registerCompaniesTools } from './companies.js';
import { registerContactsTools } from './contacts.js';
import { registerLeadsTools } from './leads.js';
import { registerNotesTools } from './notes.js';
import { registerPipelinesTools } from './pipelines.js';
import { registerTasksTools } from './tasks.js';
import { registerUsersTools } from './users.js';
import type { ToolContext } from './helpers.js';

export function registerAllTools(server: McpServer, ctx: ToolContext): void {
  registerAccountTools(server, ctx);
  registerLeadsTools(server, ctx);
  registerContactsTools(server, ctx);
  registerCompaniesTools(server, ctx);
  registerUsersTools(server, ctx);
  registerPipelinesTools(server, ctx);
  registerNotesTools(server, ctx);
  registerTasksTools(server, ctx);
}
