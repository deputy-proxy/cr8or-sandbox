# Railway Sandbox MCP

A small remote MCP server that exposes Railway Sandboxes as a development execution environment.

The intended loop is:

```text
ChatGPT
  -> remote MCP /mcp
  -> Railway Sandbox MCP
  -> Railway TypeScript SDK
  -> Railway Sandbox
  -> git / PHP / Composer / Artisan / npm / tests
```

This keeps development infrastructure separate from the application repositories being worked on.

## Tools

| Tool | Purpose |
| --- | --- |
| `sandbox_list` | List accessible Railway Sandboxes |
| `sandbox_create` | Create a sandbox and return its ID |
| `sandbox_exec` | Execute a shell command in a sandbox |
| `sandbox_read_file` | Read a UTF-8 file from a sandbox |
| `sandbox_write_file` | Write a UTF-8 file to a sandbox |
| `sandbox_destroy` | Destroy a sandbox |

`sandbox_exec` intentionally exposes a shell because the point of this service is to provide a real development environment. Authentication and Railway project credentials therefore need to be treated as production secrets, not as decorative environment variables.

## Requirements

- Node.js 22+
- A Railway project/environment with Sandbox access
- A Railway project token or account API token with access to that environment
- An MCP client that supports remote Streamable HTTP

## Environment

Copy `.env.example` and configure:

- `MCP_AUTH_TOKEN`: long random secret required on every `/mcp` request.
- `RAILWAY_TOKEN`: recommended Railway project token. `RAILWAY_API_TOKEN` is also supported by the SDK.
- `RAILWAY_ENVIRONMENT_ID`: Railway environment containing the sandboxes.
- `ALLOWED_HOSTS`: optional comma-separated public hostnames accepted by MCP host validation.
- `PORT`: supplied automatically by Railway.

Do not commit real credentials.

## Run locally

```bash
npm install
npm run check
npm run build
MCP_AUTH_TOKEN=change-me RAILWAY_TOKEN=... RAILWAY_ENVIRONMENT_ID=... npm start
```

The MCP endpoint is:

```text
http://localhost:3000/mcp
```

The health endpoint is:

```text
http://localhost:3000/health
```

## Deploy to Railway

1. Create a Railway service from this GitHub repository.
2. Configure `MCP_AUTH_TOKEN`.
3. Configure `RAILWAY_TOKEN` with a project token scoped to the environment that should own the sandboxes.
4. Configure `RAILWAY_ENVIRONMENT_ID`.
5. Deploy the service.
6. Generate a public domain for the service.
7. Set `ALLOWED_HOSTS` to the generated hostname if host allow-listing is desired.
8. Use the resulting `https://.../mcp` URL as the remote MCP endpoint.

Railway's current MCP guidance uses Streamable HTTP for hosted MCP servers. The current MCP TypeScript SDK v2 implements the 2026-07-28 protocol revision and can serve 2025-era traffic statelessly as a compatibility fallback.

## Development workflow

A typical sandbox session can be created once and reused:

```text
sandbox_create
  -> sandbox_exec: git clone ... /root/workspace
  -> sandbox_exec: composer install
  -> sandbox_exec: npm install
  -> sandbox_exec: php artisan test
  -> sandbox_exec: vendor/bin/pint --test
  -> sandbox_exec: vendor/bin/phpstan analyse
  -> sandbox_exec: npm run build
  -> sandbox_read_file / sandbox_exec for diagnostics
  -> sandbox_write_file for targeted edits
  -> sandbox_exec: git status / git diff
```

The sandbox is separate from the MCP service process, so application dependencies, Composer state, PHP tooling, Node tooling, and repository files remain inside the sandbox.

## Security model

The server is intentionally small:

- The MCP endpoint requires a bearer token before any MCP request reaches the handler.
- Railway credentials remain only in the MCP service environment.
- Sandbox command execution occurs inside Railway's isolated sandbox infrastructure, not in the MCP service container.
- `sandbox_exec` has bounded command length and timeout values.
- File writes have a bounded payload size.
- The service exposes only the six sandbox operations above.

For stronger isolation, create sandboxes with `networkIsolation: "ISOLATED"` unless private Railway service access is explicitly required.

## Why this exists

The built-in execution environment used by ChatGPT cannot be relied on as a networked development workstation for GitHub repositories. This service moves the actual development loop into a Railway Sandbox where Git, Composer, PHP, Node, and project dependencies can access the network normally.
