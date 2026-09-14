import express, { type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { Sandbox } from "railway";
import { z } from "zod";

const port = Number(process.env.PORT ?? 3000);
const authToken = process.env.MCP_AUTH_TOKEN;

if (!authToken) {
  throw new Error("MCP_AUTH_TOKEN is required");
}

const app = express();
app.use(express.json({ limit: "1mb" }));

const transports = new Map<string, StreamableHTTPServerTransport>();

function authorized(req: Request): boolean {
  return req.header("authorization") === `Bearer ${authToken}`;
}

function createServer(): McpServer {
  const server = new McpServer({
    name: "railway-sandbox-mcp",
    version: "0.1.0",
  });

  server.registerTool(
    "sandbox_list",
    {
      description: "List Railway Sandboxes accessible with the configured Railway credentials.",
      inputSchema: {},
    },
    async () => {
      const sandboxes = await Sandbox.list();
      return {
        content: [{ type: "text", text: JSON.stringify(sandboxes) }],
      };
    },
  );

  server.registerTool(
    "sandbox_create",
    {
      description: "Create a Railway Sandbox for development work and return its ID.",
      inputSchema: {
        idleTimeoutMinutes: z.number().int().min(1).max(1440).optional(),
        networkIsolation: z.enum(["ISOLATED", "PRIVATE"]).optional(),
        region: z.string().min(1).max(100).optional(),
      },
    },
    async ({ idleTimeoutMinutes, networkIsolation, region }) => {
      const sandbox = await Sandbox.create({
        ...(idleTimeoutMinutes !== undefined ? { idleTimeout: idleTimeoutMinutes * 60 } : {}),
        ...(networkIsolation ? { networkIsolation } : {}),
        ...(region ? { region } : {}),
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ id: sandbox.id }) }],
      };
    },
  );

  server.registerTool(
    "sandbox_exec",
    {
      description: "Execute a shell command inside an existing Railway Sandbox.",
      inputSchema: {
        sandboxId: z.string().min(1),
        command: z.string().min(1).max(20000),
        cwd: z.string().min(1).max(4096).optional(),
        timeoutSeconds: z.number().int().min(1).max(900).optional(),
      },
    },
    async ({ sandboxId, command, cwd, timeoutSeconds }) => {
      const sandbox = await Sandbox.connect(sandboxId);
      const result = await sandbox.exec(command, {
        ...(cwd ? { cwd } : {}),
        ...(timeoutSeconds ? { timeout: timeoutSeconds * 1000 } : {}),
      });
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
          }),
        }],
        isError: result.exitCode !== 0,
      };
    },
  );

  server.registerTool(
    "sandbox_read_file",
    {
      description: "Read a UTF-8 text file from a Railway Sandbox.",
      inputSchema: {
        sandboxId: z.string().min(1),
        path: z.string().min(1).max(4096),
      },
    },
    async ({ sandboxId, path }) => {
      const sandbox = await Sandbox.connect(sandboxId);
      const content = await sandbox.files.read(path);
      return { content: [{ type: "text", text: content }] };
    },
  );

  server.registerTool(
    "sandbox_write_file",
    {
      description: "Write a UTF-8 text file in a Railway Sandbox.",
      inputSchema: {
        sandboxId: z.string().min(1),
        path: z.string().min(1).max(4096),
        content: z.string().max(2_000_000),
      },
    },
    async ({ sandboxId, path, content }) => {
      const sandbox = await Sandbox.connect(sandboxId);
      await sandbox.files.write(path, content);
      return { content: [{ type: "text", text: JSON.stringify({ path, bytes: Buffer.byteLength(content) }) }] };
    },
  );

  server.registerTool(
    "sandbox_destroy",
    {
      description: "Destroy a Railway Sandbox when development work is complete.",
      inputSchema: { sandboxId: z.string().min(1) },
    },
    async ({ sandboxId }) => {
      const sandbox = await Sandbox.connect(sandboxId);
      await sandbox.destroy();
      return { content: [{ type: "text", text: JSON.stringify({ id: sandboxId, destroyed: true }) }] };
    },
  );

  return server;
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.all("/mcp", async (req: Request, res: Response) => {
  if (!authorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const sessionId = req.header("mcp-session-id");
  let transport = sessionId ? transports.get(sessionId) : undefined;

  try {
    if (!transport) {
      if (req.method !== "POST" || !isInitializeRequest(req.body)) {
        res.status(400).json({ error: "MCP session is not initialized" });
        return;
      }

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => transports.set(id, transport!),
        onsessionclosed: (id) => transports.delete(id),
      });

      await createServer().connect(transport);
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Internal server error" });
    }
  }
});

const server = app.listen(port, () => {
  console.log(`Railway Sandbox MCP listening on port ${port}`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
