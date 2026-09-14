import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_WORKSPACE_ROOT,
  REPOSITORY_MARKER,
  normalizeRepositoryIdentity,
  repositoryWorktreePath,
} from "../src/sandbox-manager.js";

describe("repository identity", () => {
  it("normalizes common GitHub repository forms", () => {
    assert.equal(normalizeRepositoryIdentity("deputy-proxy/valid-guide"), "deputy-proxy/valid-guide");
    assert.equal(normalizeRepositoryIdentity("https://github.com/deputy-proxy/valid-guide.git"), "deputy-proxy/valid-guide");
    assert.equal(normalizeRepositoryIdentity("http://github.com/deputy-proxy/valid-guide/"), "deputy-proxy/valid-guide");
  });

  it("rejects invalid identities", () => {
    assert.throws(() => normalizeRepositoryIdentity("valid-guide"), /Invalid repository identity/);
    assert.throws(() => normalizeRepositoryIdentity("deputy-proxy/valid-guide/extra"), /Invalid repository identity/);
  });
});

describe("repository workspace", () => {
  it("creates a stable repository-specific worktree path", () => {
    assert.equal(
      repositoryWorktreePath("deputy-proxy/valid-guide"),
      `${DEFAULT_WORKSPACE_ROOT}/deputy-proxy/valid-guide`,
    );
    assert.equal(repositoryWorktreePath("deputy-proxy/valid-guide", "/workspace"), "/workspace/deputy-proxy/valid-guide");
  });
});

describe("repository marker", () => {
  it("uses a stable marker inside the sandbox", () => {
    assert.equal(REPOSITORY_MARKER, "/root/.railway-sandbox-mcp/repository.json");
  });
});
