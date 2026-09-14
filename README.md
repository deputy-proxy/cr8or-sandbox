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

## Tools

| Tool | Purpose |
| --- | --- |
| `sandbox_list` | List accessible Railway Sandboxes |
| `sandbox_create` | Create a sandbox and return its ID |
| `sandbox_exec` | Execute a shell command in a sandbox |
| `sandbox_read_file` | Read a UTF-8 file from a sandbox |
| `sandbox_write_file` | Write a UTF-8 file to a sandbox |
| `sandbox_destroy` | Destroy a sandbox |
| `repository_prepare` | Find or create the persistent development Sandbox for a repository and prepare its issue branch |

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

## Persistent repository Sandboxes

The repository-aware development workflow uses one persistent Railway Sandbox per repository.

The model is:

```text
repository
    |
    v
repository_prepare
    |
    +-- existing usable Sandbox?
    |       |
    |       +-- yes -> reconnect -> synchronize -> checkout issue branch
    |
    +-- no -> create Sandbox from development template
                 |
                 +-- install Git
                 +-- install Node.js 22
                 +-- install PHP 8.4
                 +-- install Composer 2
                 +-- clone repository
                 +-- persist repository marker
                 +-- checkout issue branch
```

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
