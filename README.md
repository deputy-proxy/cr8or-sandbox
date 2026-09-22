# Railway Sandbox MCP

A small remote MCP server that exposes Railway Sandboxes as a development execution environment.

The intended loop is:

```text
ChatGPT -> remote MCP /mcp -> Railway Sandbox MCP -> Railway SDK -> Railway Sandbox -> git / PHP / Composer / Artisan / npm / tests
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
| `repository_prepare` | Find or create the persistent development Sandbox for a repository and prepare its issue branch |

## Requirements

- Node.js 22+
- A Railway project/environment with Sandbox access
- A Railway project token or account API token with access to that environment
- An MCP client that supports remote Streamable HTTP

## Environment

Copy `.env.example` and configure `MCP_AUTH_TOKEN`, `RAILWAY_TOKEN`, `RAILWAY_ENVIRONMENT_ID`, and optionally `ALLOWED_HOSTS`. `PORT` is supplied by Railway. Do not commit real credentials.

## Run locally

```bash
npm install
npm run check
npm run test
npm run build
MCP_AUTH_TOKEN=change-me RAILWAY_TOKEN=... RAILWAY_ENVIRONMENT_ID=... npm start
```

The MCP endpoint is `http://localhost:3000/mcp` and the health endpoint is `http://localhost:3000/health`.

## Persistent repository Sandboxes

The repository-aware workflow uses **one persistent Railway Sandbox per repository**. The Sandbox survives MCP process restarts and is discovered again with `Sandbox.list()` and `Sandbox.connect()`.

```text
repository -> repository_prepare
                 |
                 +-> existing usable Sandbox -> reconnect -> synchronize -> checkout issue branch
                 |
                 +-> no usable Sandbox -> create -> install toolchain -> clone -> persist marker -> checkout
```

The development template provisions Git, Node.js 24, PHP CLI 8.4 or newer, and Composer 2 by default. During repository preparation, the manager reads `.nvmrc`, `.node-version`, or `package.json` `engines.node` and reconciles Node.js to the repository's declared major version. Open minimum ranges such as `>=22` use the current default major (24), while exact or bounded major requirements are respected. The repository marker is `/root/.railway-sandbox-mcp/repository.json` and contains repository metadata plus the Sandbox ID. Credentials are never stored there.

Each issue uses a normal Git branch inside the same persistent repository worktree. Before preparing an issue, the manager fetches remote state, resets the worktree to `origin/HEAD`, removes untracked files, and checks out the requested branch. If that branch does not exist remotely, it is created from the default branch.

A repository-specific in-process lock prevents concurrent preparation of the same repository within one MCP instance. It is not distributed across multiple MCP replicas.

Repository Sandboxes are persistent by default. An explicit idle timeout can still be supplied, subject to Railway plan limits.

## Development loop

```text
repository_prepare -> persistent Sandbox -> issue branch
       -> inspect -> implement -> test -> lint/static analysis -> diff
       -> commit -> push -> GitHub Actions
       -> merge, or diagnose root cause and fix
       -> next issue -> same Sandbox
```

The high-level `repository_prepare` tool is the preferred entry point for repository development. The lower-level `sandbox_*` tools remain available for direct Sandbox administration and troubleshooting.

## Security model

- The MCP endpoint requires a bearer token before MCP requests reach the handler.
- Railway credentials remain only in the MCP service environment.
- Sandbox command execution occurs inside Railway Sandbox infrastructure.
- Command execution and file writes have bounded input sizes/timeouts.
- Repository markers contain no credentials.
- Repository preparation uses isolated network mode by default unless private Railway service access is explicitly requested.

## Deployment

Create a Railway service from this repository, configure the required environment variables, generate a public domain, and use the resulting `/mcp` endpoint as the remote MCP endpoint. Set `ALLOWED_HOSTS` to the generated hostname when host allow-listing is desired.
