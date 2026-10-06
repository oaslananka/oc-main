import assert from "node:assert/strict";
import test from "node:test";
import { apiPath } from "../src/github.mjs";

test("apiPath produces a relative GitHub API path", () => {
  assert.equal(
    apiPath("repos/owner/repo/pulls/1"),
    "/repos/owner/repo/pulls/1",
  );
});

test("apiPath rejects path traversal", () => {
  assert.throws(
    () => apiPath("repos/owner/../issues"),
    /path traversal/,
  );
  assert.throws(
    () => apiPath("repos/owner/%2e%2e/issues"),
    /path traversal/,
  );
  assert.throws(
    () => apiPath("repos/owner/%2Fadmin"),
    /path traversal/,
  );
});

test("apiPath rejects absolute URLs", () => {
  assert.throws(
    () => apiPath("https://example.com/anything"),
    /invalid GitHub API path/,
  );
});
