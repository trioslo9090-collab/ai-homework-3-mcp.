import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';

const execFileAsync = promisify(execFile);

class AuthServiceMCPServer {
  private server: McpServer;

  constructor() {
    this.server = new McpServer({
      name: 'auth-service-mcp',
      version: '1.0.0',
    });

    this.setupTools();
  }

  private setupTools(): void {
    // list_containers tool
    this.server.registerTool(
      'list_containers',
      {
        description:
          'List all running Docker containers with their status and port mappings. Use this first to verify AuthService container (auth-service) is running and check port 3000 is exposed. Essential for diagnosing "connection refused" or test timeout issues.',
        inputSchema: {},
      },
      async () => {
        try {
          const result = await this.handleListContainers();
          return { content: [{ type: 'text', text: result }] };
        } catch (error) {
          throw error;
        }
      }
    );

    // get_container_logs tool
    this.server.registerTool(
      'get_container_logs',
      {
        description:
          'Get Docker container logs (stderr/stdout from docker logs). Shows server startup messages, runtime warnings, and uncaught exceptions. Use this when: (1) server fails to start completely, (2) seeing HTTP 500 errors without details in app.log, (3) debugging container initialization issues. This shows system-level problems that app.log may not capture.',
        inputSchema: {
          container: z.string().optional().default('auth-service').describe('Container name or ID'),
          tail: z.number().optional().default(100).describe('Number of lines to return'),
        },
      },
      async (args) => {
        try {
          const result = await this.handleGetContainerLogs(
            args.container as string,
            args.tail as number
          );
          return { content: [{ type: 'text', text: result }] };
        } catch (error) {
          throw error;
        }
      }
    );

    // read_app_log tool
    this.server.registerTool(
      'read_app_log',
      {
        description:
          'Read application logs from /app/logs/app.log inside container. Returns structured JSON logs with event type, timestamp, and context (email, status code, error reason). Use this as the PRIMARY diagnostic tool when: (1) test fails with 400/401/403/404/500 status (read logs to see exact reason), (2) login fails unexpectedly (logs show user_not_found vs invalid_password vs user_blocked), (3) analyzing patterns in API requests, (4) correlating test execution with server events. Filter parameter allows searching by status code (e.g., "401", "500") or event type (e.g., "login_attempt", "error").',
        inputSchema: {
          container: z.string().optional().default('auth-service').describe('Container name or ID'),
          tail: z
            .number()
            .optional()
            .default(100)
            .describe('Number of lines to return from end of file'),
          filter: z
            .string()
            .optional()
            .describe(
              'Regex pattern to filter lines (e.g., "401", "error", "login_attempt", "statusCode.*5")'
            ),
        },
      },
      async (args) => {
        try {
          const result = await this.handleReadAppLog(
            args.container as string,
            args.tail as number,
            args.filter as string | undefined
          );
          return { content: [{ type: 'text', text: result }] };
        } catch (error) {
          throw error;
        }
      }
    );

    // query_database tool
    this.server.registerTool(
      'query_database',
      {
        description:
          'Execute read-only SQL queries (SELECT or PRAGMA) against SQLite database at /app/database.sqlite. Returns query results as JSON. Use this to: (1) verify user exists and has correct status (check if blocked/active), (2) confirm test data seeding worked correctly, (3) investigate database state after test failures, (4) correlate database records with API responses in logs. Example: SELECT id, email, status FROM users; SELECT * FROM users WHERE email = \'test@test.com\';',
        inputSchema: {
          sql: z.string().describe('SQL query: SELECT or PRAGMA only (no INSERT/UPDATE/DELETE). Example: SELECT id, email, status FROM users'),
          container: z.string().optional().default('auth-service').describe('Container name or ID'),
        },
      },
      async (args) => {
        try {
          const result = await this.handleQueryDatabase(
            args.sql as string,
            args.container as string
          );
          return { content: [{ type: 'text', text: result }] };
        } catch (error) {
          throw error;
        }
      }
    );
  }

  private async handleListContainers(): Promise<string> {
    try {
      const { stdout } = await execFileAsync('docker', [
        'ps',
        '--format',
        '{{.Names}}\t{{.Status}}\t{{.Ports}}',
      ]);

      const lines = stdout.trim().split('\n').filter((l) => l.trim());

      if (lines.length === 0) {
        return 'No running containers found';
      }

      const formatted = lines
        .map((line) => {
          const parts = line.split('\t');
          const name = parts[0];
          const status = parts[1];
          const ports = parts[2] || 'none';
          return `- ${name} | Status: ${status} | Ports: ${ports}`;
        })
        .join('\n');

      return `Running containers:\n${formatted}`;
    } catch (error) {
      throw new Error(
        `Failed to list containers: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async handleGetContainerLogs(container: string, tail: number): Promise<string> {
    try {
      const { stdout } = await execFileAsync('docker', [
        'logs',
        '--tail',
        tail.toString(),
        container,
      ]);

      return `Docker logs from ${container} (last ${tail} lines):\n\n${stdout}`;
    } catch (error) {
      throw new Error(
        `Failed to get container logs: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async handleReadAppLog(
    container: string,
    tail: number,
    filter?: string
  ): Promise<string> {
    try {
      const { stdout } = await execFileAsync('docker', [
        'exec',
        container,
        'tail',
        '-n',
        tail.toString(),
        '/app/logs/app.log',
      ]);

      let lines = stdout.trim().split('\n').filter((l) => l.trim());

      if (filter) {
        const filterRegex = new RegExp(filter, 'i');
        lines = lines.filter((line) => filterRegex.test(line));
      }

      const parsedLines = lines.map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { raw: line };
        }
      });

      const formatted = parsedLines.map((obj) => JSON.stringify(obj, null, 2)).join('\n---\n');

      return `Application logs from ${container} (${filter ? `filtered by "${filter}", ` : ''}${lines.length} matching lines):\n\n${formatted}`;
    } catch (error) {
      throw new Error(
        `Failed to read app logs: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async handleQueryDatabase(sql: string, container: string): Promise<string> {
    let trimmedSql = sql.trim();

    // Allow optional trailing semicolon (remove it)
    if (trimmedSql.endsWith(';')) {
      trimmedSql = trimmedSql.slice(0, -1).trim();
    }

    // Validate: only SELECT or PRAGMA
    const upperSql = trimmedSql.toUpperCase();
    if (!upperSql.startsWith('SELECT') && !upperSql.startsWith('PRAGMA')) {
      throw new Error(
        `Query not allowed: Only SELECT and PRAGMA queries are permitted. Your query: ${sql}`
      );
    }

    // Reject multiple statements (containing semicolon in the middle)
    if (trimmedSql.includes(';')) {
      throw new Error(
        `Query not allowed: Multiple statements (containing ";") are not permitted. Your query: ${sql}`
      );
    }

    try {
      // Node.js script for safe query execution (SQL passed as argument, not embedded)
      const nodeScript = `
const sqlite3 = require('sqlite3').verbose();
const sql = process.argv[1];

const db = new sqlite3.Database('/app/database.sqlite', sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  }
});

db.all(sql, (err, rows) => {
  if (err) {
    console.error(JSON.stringify({ error: err.message }));
    db.close();
    process.exit(1);
  }
  console.log(JSON.stringify(rows, null, 2));
  db.close();
});
`;

      const { stdout, stderr } = await execFileAsync(
        'docker',
        ['exec', '-w', '/app', container, 'node', '-e', nodeScript, trimmedSql],
        { maxBuffer: 10 * 1024 * 1024 }
      );

      // Check for errors in stderr
      if (stderr && stderr.includes('error')) {
        throw new Error(`Database error: ${stderr}`);
      }

      return `Query result:\n\n${stdout}`;
    } catch (error) {
      throw new Error(
        `Database query failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

const server = new AuthServiceMCPServer();
await server.run();
