import assert from "node:assert/strict";
import test from "node:test";
import { campaignObservationStopReason, observeMaintenanceCampaign } from "../src/campaign-observer.mjs";

function snapshot(id = 1) {
  return { id };
}

function decision(action, reason, statusPhase) {
  return { action, reason, statusPhase, dispatchEligible: action === "retry-eligible" };
}

test("settled decision completes in one observation without sleeping", async () => {
  const updates = [];
  let sleeps = 0;
  const result = await observeMaintenanceCampaign({
    loadSnapshot: async () => snapshot(),
    evaluate: () => decision("owner-review", "clean-settled-head", "owner-review"),
    updateStatus: async (value) => updates.push(value),
    sleep: async () => { sleeps += 1; },
    maxAttempts: 4,
    intervalMs: 0,
  });

  assert.equal(result.attempts, 1);
  assert.equal(result.timedOut, false);
  assert.equal(result.decision.reason, "clean-settled-head");
  assert.equal(updates.length, 1);
  assert.equal(sleeps, 0);
});

test("pending required checks are observed again until settled", async () => {
  const decisions = [
    decision("hold", "required-checks-pending", "waiting-checks"),
    decision("retry-eligible", "blocking-regression", "ready-remediation"),
  ];
  const updates = [];
  const sleeps = [];

  const result = await observeMaintenanceCampaign({
    loadSnapshot: async ({ attempt }) => snapshot(attempt),
    evaluate: () => decisions.shift(),
    updateStatus: async (value) => updates.push(value),
    sleep: async (milliseconds) => sleeps.push(milliseconds),
    maxAttempts: 4,
    intervalMs: 25,
  });

  assert.equal(result.attempts, 2);
  assert.equal(result.timedOut, false);
  assert.equal(result.decision.action, "retry-eligible");
  assert.deepEqual(sleeps, [25]);
  assert.deepEqual(
    updates.map((entry) => entry.decision.statusPhase),
    ["waiting-checks", "ready-remediation"],
  );
});

test("stale evidence is refreshed within the same bounded observer", async () => {
  const decisions = [
    decision("refresh-evidence", "evidence-stale", "waiting-checks"),
    decision("owner-review", "clean-settled-head", "owner-review"),
  ];
  let sleeps = 0;

  const result = await observeMaintenanceCampaign({
    loadSnapshot: async ({ attempt }) => snapshot(attempt),
    evaluate: () => decisions.shift(),
    updateStatus: async () => {},
    sleep: async () => { sleeps += 1; },
    maxAttempts: 3,
    intervalMs: 0,
  });

  assert.equal(result.attempts, 2);
  assert.equal(result.decision.reason, "clean-settled-head");
  assert.equal(sleeps, 1);
});

test("pending checks time out to owner review without dispatch authority", async () => {
  const updates = [];
  let sleeps = 0;

  const result = await observeMaintenanceCampaign({
    loadSnapshot: async ({ attempt }) => snapshot(attempt),
    evaluate: () =>
      decision("hold", "required-checks-pending", "waiting-checks"),
    updateStatus: async (value) => updates.push(value),
    sleep: async () => { sleeps += 1; },
    maxAttempts: 3,
    intervalMs: 0,
  });

  assert.equal(result.attempts, 3);
  assert.equal(result.timedOut, true);
  assert.equal(result.decision.action, "owner-review");
  assert.equal(result.decision.reason, "observation-timeout");
  assert.equal(result.decision.dispatchEligible, false);
  assert.equal(sleeps, 2);
  assert.deepEqual(
    updates.map((entry) => entry.decision.statusPhase),
    ["waiting-checks", "waiting-checks", "owner-review"],
  );
  assert.equal(updates[2].timedOut, true);
});

test("in-flight campaign state is not polled by the post-finalizer observer", async () => {
  let loads = 0;
  let sleeps = 0;
  const result = await observeMaintenanceCampaign({
    loadSnapshot: async () => {
      loads += 1;
      return snapshot();
    },
    evaluate: () => decision("hold", "iteration-in-flight", "dispatching"),
    updateStatus: async () => {},
    sleep: async () => { sleeps += 1; },
    maxAttempts: 5,
    intervalMs: 0,
  });

  assert.equal(result.attempts, 1);
  assert.equal(result.decision.reason, "iteration-in-flight");
  assert.equal(loads, 1);
  assert.equal(sleeps, 0);
});

test("observer never invokes a dispatch surface", async () => {
  const keys = [];
  const result = await observeMaintenanceCampaign({
    loadSnapshot: async () => snapshot(),
    evaluate: () => decision("retry-eligible", "blocking-regression", "ready-remediation"),
    updateStatus: async (value) => keys.push(...Object.keys(value)),
    sleep: async () => {},
    maxAttempts: 2,
    intervalMs: 0,
  });

  assert.equal(result.decision.dispatchEligible, true);
  assert.equal(keys.includes("dispatch"), false);
  assert.equal(keys.includes("repositoryDispatch"), false);
});

test("observer validates bounds and injected functions", async () => {
  await assert.rejects(
    observeMaintenanceCampaign({
      loadSnapshot: async () => snapshot(),
      updateStatus: async () => {},
      maxAttempts: 0,
    }),
    /max attempts/,
  );
  await assert.rejects(
    observeMaintenanceCampaign({
      loadSnapshot: async () => snapshot(),
      updateStatus: async () => {},
      intervalMs: 120001,
    }),
    /interval/,
  );
  await assert.rejects(
    observeMaintenanceCampaign({
      loadSnapshot: null,
      updateStatus: async () => {},
    }),
    TypeError,
  );
});

test("closed campaign stop sentinel exits without status writes", async () => {
  let updates = 0;
  let sleeps = 0;
  const result = await observeMaintenanceCampaign({
    loadSnapshot: async () => ({ stop: true, reason: "pull-request-closed" }),
    updateStatus: async () => { updates += 1; },
    sleep: async () => { sleeps += 1; },
    maxAttempts: 3,
    intervalMs: 0,
  });

  assert.equal(result.stopped, true);
  assert.equal(result.stopReason, "pull-request-closed");
  assert.equal(result.decision, null);
  assert.equal(updates, 0);
  assert.equal(sleeps, 0);
});

test("old observer stops when a newer campaign iteration has started", () => {
  assert.equal(
    campaignObservationStopReason(
      {
        iteration: 2,
        last_comment_id: 202,
        in_flight: true,
        terminal: false,
      },
      { iteration: 1, commentId: 101 },
    ),
    "campaign-advanced",
  );
  assert.equal(
    campaignObservationStopReason(
      {
        iteration: 1,
        last_comment_id: 101,
        in_flight: false,
        terminal: false,
      },
      { iteration: 1, commentId: 101 },
    ),
    "",
  );
});

test("terminalized campaign stops an older observer", () => {
  assert.equal(
    campaignObservationStopReason(
      {
        iteration: 1,
        last_comment_id: 101,
        in_flight: false,
        terminal: true,
      },
      { iteration: 1, commentId: 101 },
    ),
    "campaign-advanced",
  );
});
