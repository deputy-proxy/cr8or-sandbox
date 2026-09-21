import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_WORKSPACE_ROOT,
  REPOSITORY_MARKER,
  normalizeGitHubRepositoryUrl,
  normalizeRepositoryIdentity,
  repositoryWorktreePath,
  resolveNodeMajor,
} from "../src/sandbox-manager.js";

describe("normalizeRepositoryIdentity", () => {
  it("accepts owner/name", () => {
    assert.equal(normalizeRepositoryIdentity("deputy-proxy/valid-guide"), "deputy-proxy/valid-guide");
  });

  it("accepts GitHub HTTPS URLs", () => {
    assert.equal(
      normalizeRepositoryIdentity("https://github.com/deputy-proxy/valid-guide.git"),
      "deputy-proxy/valid-guide",
    );
  });

  it("accepts GitHub HTTP URLs", () => {
    assert.equal(
      normalizeRepositoryIdentity("http://github.com/deputy-proxy/valid-guide/"),
      "deputy-proxy/valid-guide",
    );
  });

  it("rejects invalid identities", () => {
    assert.throws(() => normalizeRepositoryIdentity("valid-guide"), /Invalid GitHub repository identity/);
    assert.throws(() => normalizeRepositoryIdentity("deputy-proxy/valid-guide/extra"), /Invalid GitHub repository identity/);
  });
});

describe("normalizeGitHubRepositoryUrl", () => {
  it("normalizes a GitHub URL", () => {
    assert.equal(
      normalizeGitHubRepositoryUrl("https://github.com/deputy-proxy/valid-guide"),
      "https://github.com/deputy-proxy/valid-guide.git",
    );
  });

  it("rejects non-GitHub URLs", () => {
    assert.throws(
      () => normalizeGitHubRepositoryUrl("https://gitlab.com/deputy-proxy/valid-guide.git"),
      /HTTPS GitHub URL/,
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
      repositoryWorktreePath("deputy-proxy/valid-guide", "/workspace"),
      "/workspace/deputy-proxy/valid-guide",
    );
  });
});

describe("repository marker", () => {
  it("uses a stable marker path", () => {
    assert.equal(REPOSITORY_MARKER, "/root/.railway-sandbox-mcp/repository.json");
  });
});


describe("resolveNodeMajor", () => {
  it("uses the exact repository major when specified", () => {
    assert.equal(resolveNodeMajor("22"), 22);
    assert.equal(resolveNodeMajor("22.x"), 22);
    assert.equal(resolveNodeMajor("^22.0.0"), 22);
  });

  it("uses the lower bound for bounded ranges", () => {
    assert.equal(resolveNodeMajor(">=20 <22"), 20);
  });

  it("uses the preferred current major for open minimum ranges", () => {
    assert.equal(resolveNodeMajor(">=22"), 24);
  });

  it("uses the preferred major when no requirement is declared", () => {
    assert.equal(resolveNodeMajor(""), 24);
  });
});
