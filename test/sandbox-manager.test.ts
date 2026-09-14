import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_WORKSPACE_ROOT,
  REPOSITORY_MARKER,
  normalizeRepositoryIdentity,
  repositoryWorktreePath,
} from "../src/sandbox-manager.js";

describe("normalizeRepositoryIdentity", () => {
  it("accepts owner/name", () => {
    assert.equal(
      normalizeRepositoryIdentity("deputy-proxy/valid-guide"),
      "deputy-proxy/valid-guide",
    );
  });

  it("accepts a GitHub HTTPS URL", () => {
    assert.equal(
      normalizeRepositoryIdentity(
        "https://github.com/deputy-proxy/valid-guide.git",
      ),
      "deputy-proxy/valid-guide",
    );
  });

  it("accepts a GitHub HTTP URL", () => {
    assert.equal(
      normalizeRepositoryIdentity(
        "http://github.com/deputy-proxy/valid-guide/",
      ),
      "deputy-proxy/valid-guide",
    );
  });

  it("rejects an invalid repository identity", () => {
    assert.throws(
      () => normalizeRepositoryIdentity("valid-guide"),
      /Invalid repository identity/,
    );
  });

  it("rejects a repository with too many path components", () => {
    assert.throws(
      () =>
        normalizeRepositoryIdentity(
          "deputy-proxy/valid-guide/extra",
        ),
      /Invalid repository identity/,
    );
  });
});

describe("repositoryWorktreePath", () => {
  it("creates a stable repository-specific path", () => {
    assert.equal(
      repositoryWorktreePath("deputy-proxy/valid-guide"),
      `${DEFAULT_WORKSPACE_ROOT}/deputy-proxy/valid-guide`,
    );
  });

  it("supports a custom root", () => {
    assert.equal(
      repositoryWorktreePath(
        "deputy-proxy/valid-guide",
        "/workspace",
      ),
      "/workspace/deputy-proxy/valid-guide",
    );
  });
});

describe("repository marker", () => {
  it("uses a stable marker path", () => {
    assert.equal(
      REPOSITORY_MARKER,
      "/root/.railway-sandbox-mcp/repository.json",
    );
  });
});
