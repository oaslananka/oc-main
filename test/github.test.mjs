import assert from "node:assert/strict";
import test from "node:test";
import { apiUrl } from "../src/github.mjs";

test("apiUrl keeps requests on the GitHub API origin", () => {
  assert.equal(
    apiUrl("repos/owner/repo/pulls/1").toString(),
    "https://api.github.com/repos/owner/repo/pulls/1",
  );
});

test("apiUrl rejects path traversal", () => {
  assert.throws(
    () => apiUrl("repos/owner/../issues"),
    /path traversal/,
  );
  assert.throws(
    () => apiUrl("repos/owner/%2e%2e/issues"),
    /path traversal/,
  );
  assert.throws(
    () => apiUrl("repos/owner/%2Fadmin"),
    /path traversal/,
  );
});

test("apiUrl rejects absolute non-GitHub URLs", () => {
  assert.throws(
    () => apiUrl("https://example.com/anything"),
    /invalid GitHub API path/,
  );
});
