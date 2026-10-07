import assert from "node:assert/strict";
import test from "node:test";
import { controllerRouteKey } from "../src/controller-route.mjs";

test("serializes all maintenance routes for one repository under one key", () => {
  assert.equal(
    controllerRouteKey({ repository: "owner/repo", maintenance: true, issueNumber: 17 }),
    "owner/repo#maintenance",
  );
  assert.equal(
    controllerRouteKey({ repository: "owner/repo", maintenance: true, pullNumber: 41 }),
    "owner/repo#maintenance",
  );
  assert.equal(
    controllerRouteKey({ repository: "owner/repo", maintenance: true }),
    "owner/repo#maintenance",
  );
});

test("keeps ordinary issue and pull request routes distinct", () => {
  assert.equal(
    controllerRouteKey({ repository: "owner/repo", issueNumber: 17 }),
    "owner/repo#issue-17",
  );
  assert.equal(
    controllerRouteKey({ repository: "owner/repo", pullNumber: 41 }),
    "owner/repo#pr-41",
  );
});

test("rejects invalid controller route identity", () => {
  assert.throws(
    () => controllerRouteKey({ repository: "owner", maintenance: true }),
    /Invalid controller route repository/,
  );
  assert.throws(
    () => controllerRouteKey({ repository: "owner/repo" }),
    /pull request number/,
  );
});