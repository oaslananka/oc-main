import assert from "node:assert/strict";
import test from "node:test";

test("automatic redispatch required policy canary - iteration 1 deliberate failure", () => {
  assert.equal(1, 1);
});