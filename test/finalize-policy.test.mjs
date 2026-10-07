import assert from "node:assert/strict";
import test from "node:test";
import { finalizationDecision } from "../src/finalize-policy.mjs";

test("read-only mode with tracked changes is blocked", () => {
  assert.equal(
    finalizationDecision({
      runStatus: "success",
      allowEdits: false,
      changed: true,
    }),
    "blocked-read-only",
  );
});

test("read-only mode without tracked changes completes without push", () => {
  assert.equal(
    finalizationDecision({
      runStatus: "success",
      allowEdits: false,
      changed: false,
    }),
    "completed-no-changes",
  );
});

test("edit-capable mode with tracked changes may reach trusted push gate", () => {
  assert.equal(
    finalizationDecision({
      runStatus: "success",
      allowEdits: true,
      changed: true,
    }),
    "push",
  );
});

test("failed agent run never reaches trusted push gate", () => {
  assert.equal(
    finalizationDecision({
      runStatus: "failure",
      allowEdits: true,
      changed: true,
    }),
    "failure",
  );
});
