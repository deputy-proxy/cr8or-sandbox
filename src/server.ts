import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import express, { type Request, type Response } from "express";
import { Sandbox } from "railway";
import * as z from "zod/v4";

const port = Number(process.env.PORT ?? 3000);
const authToken = process.env.MCP_AUTH_TOKEN;

if (!authToken) {
  throw new Error("MCP_AUTH_TOKEN is required");
}

const allowedHosts = process.env.ALLOWED_HOSTS
  ?.split(",")
  .map((host) => host.trim())
  .filter(Boolean);

function isAuthorized(req: Request): boolean {
  return req.header("authorization") === `Bearer ${authToken}`;
}

function buildServer(): McpServer {
  const server = new McpServer({
    name: "railway-sandbox-mcp",
    version: "0.1.0",
  });

  server.registerTool(
    "sandbox_list",
    {
      description: "List Railway Sandboxes accessible with the configured Railway credentials.",
    },
    async () => {
      const sandboxes = await Sandbox.list();
      return { content: [{ type: "text", text: JSON.stringify(sandboxes) }] };
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
        ...(idleTimeoutMinutes !== undefined ? { idleTimeoutMinutes } : {}),
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
        command: z.string().min(1).max(20_000),
        cwd: z.string().min(1).max(4096).optional(),
        timeoutSeconds: z.number().int().min(1).max(900).optional(),
      },
    },
    async ({ sandboxId, command, cwd, timeoutSeconds }) => {
      const sandbox = await Sandbox.connect(sandboxId);
      const result = await sandbox.exec(command, {
        ...(cwd ? { cwd } : {}),
        ...(timeoutSeconds ? { timeoutSec: timeoutSeconds } : {}),
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            truncated: result.truncated,
          }),
        }],
        isError: result.exitCode !== 0 || result.timedOut === true,
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
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ path, bytes: Buffer.byteLength(content) }),
        }],
      };
    },
  );

  server.registerTool(
    "sandbox_destroy",
    {
      description: "Destroy a Railway Sandbox when development work is complete.",
      inputSchema: {
        sandboxId: z.string().min(1),
      },
    },
    async ({ sandboxId }) => {
      const sandbox = await Sandbox.connect(sandboxId);
      await sandbox.destroy();
      return {
        content: [{ type: "text", text: JSON.stringify({ id: sandboxId, destroyed: true }) }],
      };
    },
  );

  return server;
}

const handler = createMcpHandler(buildServer);
const nodeHandler = toNodeHandler(handler);

const app = createMcpExpressApp({
  host: "0.0.0.0",
  ...(allowedHosts?.length ? { allowedHosts } : {}),
  jsonLimit: "1mb",
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.all("/mcp", (req: Request, res: Response) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  void nodeHandler(req, res, req.body);
});

const httpServer = app.listen(port, "0.0.0.0", () => {
  console.log(`Railway Sandbox MCP listening on port ${port}`);
});

const shutdown = async () => {
  await handler.close();
  httpServer.close(() => process.exit(0));
};

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
