import express, { type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Connector } from './amocrm/connector.js';
import { FileTokenStorage } from './amocrm/tokenStorage.js';
import { bearerAuth } from './auth.js';
import { loadConfig, type AppConfig } from './config.js';
import { createLogger } from './logger.js';
import { registerAllTools } from './tools/register.js';

export function buildMcpServer(config: AppConfig): McpServer {
  const logger = createLogger(config.logLevel);
  const storage = new FileTokenStorage(config.tokensDir);
  const connector = new Connector({
    oauth: config.oauth,
    storage,
    logger,
  });

  const server = new McpServer({
    name: 'amocrm',
    version: '0.1.0',
  });

  registerAllTools(server, {
    connector,
    defaultAccountId: config.defaultAccountId,
  });

  return server;
}

export function buildApp(config: AppConfig): express.Express {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/mcp', bearerAuth(config.authToken));

  // Stateless mode: spin up a fresh MCP server + transport per request.
  // Simple, no session bookkeeping, fine for tool-call-driven usage.
  const handleMcp = async (req: Request, res: Response): Promise<void> => {
    const server = buildMcpServer(config);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: (err as Error).message },
          id: null,
        });
      }
    }
  };

  app.post('/mcp', handleMcp);
  // In stateless mode GET/DELETE are not supported (no SSE session, no resumption).
  app.get('/mcp', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed (stateless mode).' },
      id: null,
    });
  });
  app.delete('/mcp', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed (stateless mode).' },
      id: null,
    });
  });

  return app;
}

// Entry point — only runs when this file is executed directly (not when imported by tests)
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const config = loadConfig();
  const app = buildApp(config);
  app.listen(config.port, config.host, () => {
    process.stderr.write(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'info',
        message: 'AmoCRM MCP server listening',
        host: config.host,
        port: config.port,
        storage: config.tokensDir,
        defaultAccountId: config.defaultAccountId,
      }) + '\n',
    );
  });
}
