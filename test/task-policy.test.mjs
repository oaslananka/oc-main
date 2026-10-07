import assert from "node:assert/strict";
import test from "node:test";
import {
  isBlockedOutput,
  requiresTrackedChange,
} from "../src/task-policy.mjs";

test("edit modes require a tracked change", () => {
  for (const mode of ["fix", "apply", "ci", "release", "refactor"]) {
    assert.equal(requiresTrackedChange(mode, true), true);
  }
});

test("read-only and auto modes do not force a tracked change", () => {
  assert.equal(requiresTrackedChange("review", false), false);
  assert.equal(requiresTrackedChange("plan", false), false);
  assert.equal(requiresTrackedChange("auto", true), false);
});

test("recognizes explicit blocker output", () => {
  assert.equal(isBlockedOutput("BLOCKED: exact analyzer data is unavailable"), true);
  assert.equal(isBlockedOutput("done"), false);
});
