import assert from "node:assert/strict";
import test from "node:test";

test("automatic redispatch E2E canary - deliberate failure for iteration 1", () => {
  // This test deliberately fails in iteration 1 to trigger the maintenance campaign.
  // Iteration 2 will fix this test to pass.
  assert.equal(1, 2);
});