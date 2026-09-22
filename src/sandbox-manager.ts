import { Sandbox, type SandboxTemplate } from "railway";

export const REPOSITORY_MARKER = "/root/.railway-sandbox-mcp/repository.json";
export const DEFAULT_WORKSPACE_ROOT = "/root/workspaces";

export interface RepositorySandboxRecord {
  repository: string;
  repositoryUrl: string;
  sandboxId: string;
  worktreePath: string;
  updatedAt: string;
}

export interface DevelopmentSandboxOptions {
  repository: string;
  repositoryUrl: string;
  branch: string;
  idleTimeoutMinutes?: number;
  region?: string;
  networkIsolation?: "ISOLATED" | "PRIVATE";
}

export function normalizeRepositoryIdentity(repository: string): string {
  const normalized = repository.trim().replace(/^https?:\/\//, "").replace(/^github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, "");
  if (!/^[^/\s]+\/[^/\s]+$/.test(normalized)) throw new Error(`Invalid GitHub repository identity: ${repository}`);
  return normalized;
}

export function normalizeGitHubRepositoryUrl(repositoryUrl: string): string {
  let url: URL;
  try { url = new URL(repositoryUrl); } catch { throw new Error(`Invalid GitHub repository URL: ${repositoryUrl}`); }
  if (url.protocol !== "https:" || url.hostname !== "github.com") throw new Error(`Repository URL must be an HTTPS GitHub URL: ${repositoryUrl}`);
  return `https://github.com/${normalizeRepositoryIdentity(url.pathname.slice(1))}.git`;
}

export function resolveNodeMajor(requirement: string, preferredMajor = 24): number {
  const normalized = requirement.trim().replace(/^v/, "");

  if (!normalized || normalized === "*" || normalized === "latest") return preferredMajor;

  const exact = normalized.match(/^(?:=|v)?(\d+)(?:\.x)?(?:\.\d+)?(?:\.\d+)?$/);
  if (exact) return Number(exact[1]);

  const bounded = normalized.match(/^(?:>=\s*)?(\d+)(?:\.\d+)?(?:\.\d+)?\s*<\s*(\d+)/);
  if (bounded) {
    const minimumMajor = Number(bounded[1]);
    const maximumMajor = Number(bounded[2]);
    return preferredMajor >= minimumMajor && preferredMajor < maximumMajor ? preferredMajor : minimumMajor;
  }

  const caretOrTilde = normalized.match(/^[~^](\d+)/);
  if (caretOrTilde) return Number(caretOrTilde[1]);

  const majorRange = normalized.match(/(?:^|\s)(\d+)\.x(?:$|\s)/);
  if (majorRange) return Number(majorRange[1]);

  const minimum = normalized.match(/^>=\s*(\d+)/);
  if (minimum) return Math.max(Number(minimum[1]), preferredMajor);

  throw new Error(`Unsupported Node.js version requirement: ${requirement}`);
}

export function repositoryWorktreePath(repository: string, root = DEFAULT_WORKSPACE_ROOT): string {
  const [owner, name] = normalizeRepositoryIdentity(repository).split("/");
  return `${root}/${owner}/${name}`;
}

export function createDevelopmentSandboxTemplate(): SandboxTemplate {
  // Keep the template build deterministic and minimal. Repository-specific
  // Node.js and Composer setup happens after the Sandbox exists, where
  // failures are observable and can be retried without rebuilding a template.
  return Sandbox.template()
    .withPackages("git", "curl", "ca-certificates", "unzip", "php-cli")
    .workdir("/root");
}

export class DevelopmentSandboxManager {
  private readonly locks = new Map<string, Promise<void>>();
  public constructor(private readonly templateFactory: () => SandboxTemplate = createDevelopmentSandboxTemplate) {}

  public async prepareRepository(options: DevelopmentSandboxOptions): Promise<{ sandbox: Sandbox; record: RepositorySandboxRecord; reused: boolean }> {
    const repository = normalizeRepositoryIdentity(options.repository);
    const repositoryUrl = normalizeGitHubRepositoryUrl(options.repositoryUrl);
    if (normalizeRepositoryIdentity(new URL(repositoryUrl).pathname.slice(1)) !== repository) throw new Error(`Repository identity does not match repository URL: ${repository} vs ${repositoryUrl}`);

    return this.lock(repository, async () => {
      const existing = await this.findExisting(repository);
      if (existing) {
        await this.sync(existing.sandbox, existing.record, { ...options, repository, repositoryUrl });
        return { ...existing, reused: true };
      }

      const sandbox = await Sandbox.create(this.templateFactory(), {
        idleTimeoutMinutes: options.idleTimeoutMinutes ?? 0,
        ...(options.region ? { region: options.region } : {}),
        networkIsolation: options.networkIsolation ?? "ISOLATED",
      });

      try {
        const worktreePath = repositoryWorktreePath(repository);
        const clone = await sandbox.exec(`mkdir -p $(dirname ${quote(worktreePath)}) && git clone ${quote(repositoryUrl)} ${quote(worktreePath)}`, { cwd: "/root", timeoutSec: 180 });
        if (clone.exitCode !== 0 || clone.timedOut) throw new Error(`Repository clone failed: ${clone.stderr || clone.stdout}`);

        const record: RepositorySandboxRecord = { repository, repositoryUrl, sandboxId: sandbox.id, worktreePath, updatedAt: new Date().toISOString() };
        await this.checkout(sandbox, record, options.branch);
        await this.reconcileToolchain(sandbox, worktreePath);
        await this.validate(sandbox, worktreePath);
        await sandbox.files.write(REPOSITORY_MARKER, `${JSON.stringify(record, null, 2)}\n`);
        return { sandbox, record, reused: false };
      } catch (error) {
        try { await sandbox.destroy(); } catch { /* keep original error */ }
        throw error;
      }
    });
  }

  private async findExisting(repository: string): Promise<{ sandbox: Sandbox; record: RepositorySandboxRecord } | null> {
    for (const info of await Sandbox.list()) {
      if (info.status !== "RUNNING") continue;
      try {
        const sandbox = await Sandbox.connect(info.id);
        const record = JSON.parse(await sandbox.files.read(REPOSITORY_MARKER)) as RepositorySandboxRecord;
        if (record.repository !== repository || record.sandboxId !== info.id) continue;
        if (normalizeRepositoryIdentity(new URL(record.repositoryUrl).pathname.slice(1)) !== repository) continue;
        const probe = await sandbox.exec("git rev-parse --is-inside-work-tree", { cwd: record.worktreePath, timeoutSec: 15 });
        if (probe.exitCode === 0 && probe.timedOut !== true && probe.stdout.trim() === "true") return { sandbox, record };
      } catch { /* ignore unusable sandboxes */ }
    }
    return null;
  }

  private async sync(sandbox: Sandbox, record: RepositorySandboxRecord, options: DevelopmentSandboxOptions): Promise<void> {
    const result = await sandbox.exec([
      `git remote set-url origin ${quote(options.repositoryUrl)}`,
      "git fetch --prune origin",
      "git remote set-head origin --auto",
      "git reset --hard origin/HEAD",
      "git clean -fdx",
    ].join(" && "), { cwd: record.worktreePath, timeoutSec: 120 });
    if (result.exitCode !== 0 || result.timedOut) throw new Error(`Repository synchronization failed: ${result.stderr || result.stdout}`);

    await this.checkout(sandbox, record, options.branch);
    await this.reconcileToolchain(sandbox, record.worktreePath);
    await this.validate(sandbox, record.worktreePath);
    await sandbox.files.write(REPOSITORY_MARKER, `${JSON.stringify({ ...record, repositoryUrl: options.repositoryUrl, updatedAt: new Date().toISOString() }, null, 2)}\n`);
  }

  private async reconcileToolchain(sandbox: Sandbox, cwd: string): Promise<void> {
    const probe = await sandbox.exec(
      "node --version 2>/dev/null || true; php --version 2>/dev/null | head -1 || true; composer --version 2>/dev/null || true",
      { cwd, timeoutSec: 30 },
    );

    if (probe.timedOut) throw new Error(`Toolchain probe timed out: ${probe.stderr || probe.stdout}`);

    const requirement = await this.detectNodeRequirement(sandbox, cwd);
    const nodeMajor = resolveNodeMajor(requirement);
    const needsNode = !new RegExp(`\\bv${nodeMajor}\\.`).test(probe.stdout);
    const needsPhp = !/^PHP 8\.(?:4|5)\./m.test(probe.stdout);
    const needsComposer = !/\bComposer version 2\./.test(probe.stdout);

    if (!needsNode && !needsPhp && !needsComposer) return;

    const commands = [
      "apt-get update",
      "apt-get install -y --no-install-recommends git curl ca-certificates unzip",
    ];

    if (needsNode) {
      commands.push(
        `curl -fsSL https://deb.nodesource.com/setup_${nodeMajor}.x | bash -`,
        "apt-get update",
        "apt-get install -y --allow-downgrades --no-install-recommends nodejs",
      );
    }

    if (needsPhp) {
      commands.push("apt-get install -y --no-install-recommends php-cli");
    }

    if (needsComposer) {
      commands.push(
        "curl -fsSL https://getcomposer.org/installer -o /tmp/composer-setup.php",
        "php /tmp/composer-setup.php --install-dir=/usr/local/bin --filename=composer",
        "rm -f /tmp/composer-setup.php",
      );
    }

    const result = await sandbox.exec(commands.join(" && "), { cwd: "/root", timeoutSec: 180 });
    if (result.exitCode !== 0 || result.timedOut) {
      throw new Error(`Toolchain reconciliation failed: ${result.stderr || result.stdout}`);
    }
  }

  private async detectNodeRequirement(sandbox: Sandbox, cwd: string): Promise<string> {
    const result = await sandbox.exec(
      "node -e 'const fs=require(\"fs\"); let r=\"\"; for (const f of [\".nvmrc\",\".node-version\"]) { if (fs.existsSync(f)) { r=fs.readFileSync(f,\"utf8\").trim(); break; } } if (!r && fs.existsSync(\"package.json\")) r=JSON.parse(fs.readFileSync(\"package.json\",\"utf8\")).engines?.node ?? \"\"; process.stdout.write(r);'",
      { cwd, timeoutSec: 15 },
    );
    if (result.exitCode !== 0 || result.timedOut) throw new Error(`Node.js requirement detection failed: ${result.stderr || result.stdout}`);
    return result.stdout.trim() || ">=22";
  }

  private async validate(sandbox: Sandbox, cwd: string): Promise<void> {
    const requirement = await this.detectNodeRequirement(sandbox, cwd);
    const nodeMajor = resolveNodeMajor(requirement);
    const result = await sandbox.exec("git --version && node --version && php --version && composer --version", { cwd, timeoutSec: 30 });
    if (result.exitCode !== 0 || result.timedOut) throw new Error(`Toolchain validation failed: ${result.stderr || result.stdout}`);
    for (const [name, pattern] of [["Node", new RegExp(`\\bv${nodeMajor}\\.`)], ["PHP", /^PHP 8\.(?:4|5)\./m], ["Composer", /Composer version 2\./]] as const) {
      if (!pattern.test(result.stdout)) throw new Error(`${name} requirement not satisfied: ${result.stdout}`);
    }
  }

  private async checkout(sandbox: Sandbox, record: RepositorySandboxRecord, branch: string): Promise<void> {
    const branchArgument = quote(branch);
    const remoteBranchReference = `refs/remotes/origin/${branch}`;
    const result = await sandbox.exec([
      "git fetch --prune origin",
      `if git show-ref --verify --quiet ${quote(remoteBranchReference)}; then`,
      `  git checkout -B ${branchArgument} origin/${branchArgument}`,
      "else",
      `  git checkout -B ${branchArgument} origin/HEAD`,
      "fi",
    ].join("\n"), { cwd: record.worktreePath, timeoutSec: 120 });
    if (result.exitCode !== 0 || result.timedOut) throw new Error(`Branch preparation failed: ${result.stderr || result.stdout}`);
  }

  private async lock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key);
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.locks.set(key, current);
    if (previous) await previous;
    try { return await operation(); } finally { release(); if (this.locks.get(key) === current) this.locks.delete(key); }
  }
}

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}
