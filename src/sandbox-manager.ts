import { Sandbox, type SandboxTemplate } from "railway";

export const REPOSITORY_MARKER = "/root/.railway-sandbox-mcp/repository.json";
export const DEFAULT_WORKSPACE_ROOT = "/root/workspaces";

export interface RepositorySandboxRecord { repository: string; sandboxId: string; worktreePath: string; updatedAt: string; }
export interface DevelopmentSandboxOptions { repository: string; repositoryUrl: string; branch: string; worktreePath?: string; idleTimeoutMinutes?: number; region?: string; networkIsolation?: "ISOLATED" | "PRIVATE"; }

export function normalizeRepositoryIdentity(repository: string): string {
  const normalized = repository.trim().replace(/^https?:\/\//, "").replace(/^github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, "");
  if (!/^[^/\s]+\/[^/\s]+$/.test(normalized)) throw new Error(`Invalid repository identity: ${repository}`);
  return normalized;
}

export function repositoryWorktreePath(repository: string, root = DEFAULT_WORKSPACE_ROOT): string {
  const [owner, name] = normalizeRepositoryIdentity(repository).split("/");
  return `${root}/${owner}/${name}`;
}

export function createDevelopmentSandboxTemplate(): SandboxTemplate {
  return Sandbox.template().withPackages("git", "nodejs", "npm", "php8.4-cli", "composer").run("npm install -g node@22").workdir("/root");
}

export class DevelopmentSandboxManager {
  private readonly locks = new Map<string, Promise<void>>();
  public constructor(private readonly templateFactory: () => SandboxTemplate = createDevelopmentSandboxTemplate) {}

  public async prepareRepository(options: DevelopmentSandboxOptions): Promise<{ sandbox: Sandbox; record: RepositorySandboxRecord; reused: boolean }> {
    const repository = normalizeRepositoryIdentity(options.repository);
    return this.lock(repository, async () => {
      const existing = await this.findExisting(repository);
      if (existing) {
        await this.sync(existing.sandbox, existing.record, options);
        return { ...existing, reused: true };
      }
      const sandbox = await Sandbox.create(this.templateFactory(), { idleTimeoutMinutes: options.idleTimeoutMinutes ?? 0, ...(options.region ? { region: options.region } : {}), networkIsolation: options.networkIsolation ?? "ISOLATED" });
      const worktreePath = options.worktreePath ?? repositoryWorktreePath(repository);
      const result = await sandbox.exec(`mkdir -p $(dirname ${quote(worktreePath)}) && git clone ${quote(options.repositoryUrl)} ${quote(worktreePath)}`, { cwd: "/root", timeoutSec: 180 });
      if (result.exitCode !== 0 || result.timedOut) throw new Error(`Repository clone failed: ${result.stderr || result.stdout}`);
      await this.validate(sandbox, worktreePath);
      const record = { repository, sandboxId: sandbox.id, worktreePath, updatedAt: new Date().toISOString() };
      await sandbox.files.write(REPOSITORY_MARKER, JSON.stringify(record, null, 2) + "\n");
      await this.checkout(sandbox, record, options.branch);
      return { sandbox, record, reused: false };
    });
  }

  private async findExisting(repository: string): Promise<{ sandbox: Sandbox; record: RepositorySandboxRecord } | null> {
    for (const info of await Sandbox.list()) {
      if (info.status !== "RUNNING") continue;
      try {
        const sandbox = await Sandbox.connect(info.id);
        const record = JSON.parse(await sandbox.files.read(REPOSITORY_MARKER)) as RepositorySandboxRecord;
        if (record.repository !== repository || record.sandboxId !== info.id) continue;
        const probe = await sandbox.exec("git rev-parse --is-inside-work-tree", { cwd: record.worktreePath, timeoutSec: 15 });
        if (probe.exitCode === 0 && probe.stdout.trim() === "true") return { sandbox, record };
      } catch { }
    }
    return null;
  }

  private async sync(sandbox: Sandbox, record: RepositorySandboxRecord, options: DevelopmentSandboxOptions): Promise<void> {
    const result = await sandbox.exec(`git remote set-url origin ${quote(options.repositoryUrl)} && git fetch --prune origin && git reset --hard origin/HEAD && git clean -fdx`, { cwd: record.worktreePath, timeoutSec: 120 });
    if (result.exitCode !== 0 || result.timedOut) throw new Error(`Repository synchronization failed: ${result.stderr || result.stdout}`);
    await this.validate(sandbox, record.worktreePath);
    await this.checkout(sandbox, record, options.branch);
    await sandbox.files.write(REPOSITORY_MARKER, JSON.stringify({ ...record, updatedAt: new Date().toISOString() }, null, 2) + "\n");
  }

  private async validate(sandbox: Sandbox, cwd: string): Promise<void> {
    const result = await sandbox.exec("git --version && node --version && php --version && composer --version", { cwd, timeoutSec: 30 });
    if (result.exitCode !== 0 || result.timedOut) throw new Error(`Toolchain validation failed: ${result.stderr || result.stdout}`);
    for (const [name, pattern] of [["Node", /v22\./], ["PHP", /PHP 8\.4\./], ["Composer", /Composer version 2\./]] as const) if (!pattern.test(result.stdout)) throw new Error(`${name} requirement not satisfied: ${result.stdout}`);
  }

  private async checkout(sandbox: Sandbox, record: RepositorySandboxRecord, branch: string): Promise<void> {
    const result = await sandbox.exec(`git fetch --prune origin && (git show-ref --verify --quiet refs/remotes/origin/${quote(branch)} && git checkout -B ${quote(branch)} origin/${quote(branch)} || git checkout -B ${quote(branch)} origin/HEAD)`, { cwd: record.worktreePath, timeoutSec: 120 });
    if (result.exitCode !== 0 || result.timedOut) throw new Error(`Branch preparation failed: ${result.stderr || result.stdout}`);
  }

  private async lock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key); let release!: () => void; const current = new Promise<void>((resolve) => { release = resolve; }); this.locks.set(key, current);
    if (previous) await previous;
    try { return await operation(); } finally { release(); if (this.locks.get(key) === current) this.locks.delete(key); }
  }
}

function quote(value: string): string { return `'${value.replace(/'/g, `'"'"'`)}'`; }
