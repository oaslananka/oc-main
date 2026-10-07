import assert from "node:assert/strict";
import test from "node:test";

test("automatic redispatch E2E canary - deliberate failure for iteration 1", () => {
  assert.equal(1, 2);
});