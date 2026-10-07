import assert from "node:assert/strict";
import test from "node:test";
import {
  abortMaintenanceCampaignIteration,
  assertActiveMaintenanceCampaignJob,
  beginMaintenanceCampaignIteration,
  completeMaintenanceCampaignIteration,
  createInitialMaintenanceCampaignState,
  maintenanceCampaignStateMarker,
  readMaintenanceCampaignState,
  writeMaintenanceCampaignState,
} from "../src/campaign-state.mjs";

const SECRET = "test-worker-dispatch-secret";
const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);

function initial() {
  return createInitialMaintenanceCampaignState({
    issueNumber: 23,
    commentId: 101,
    pullNumber: 26,
    headSha: HEAD_A,
  });
}

test("signed campaign state round-trips through a hidden PR body marker", () => {
  const state = initial();
  const body = writeMaintenanceCampaignState(
    "Maintenance campaign workspace.",
    state,
    SECRET,
  );

  assert.match(body, /oc-main-maintenance-campaign-state/);
  assert.equal(body.includes(SECRET), false);
  assert.deepEqual(readMaintenanceCampaignState(body, SECRET), state);
});

test("campaign state rejects marker tampering and duplicate markers", () => {
  const marker = maintenanceCampaignStateMarker(initial(), SECRET);
  const tampered = marker.replace(/[0-9a-f](?= -->$)/, (value) =>
    value === "a" ? "b" : "a",
  );
  assert.throws(
    () => readMaintenanceCampaignState(tampered, SECRET),
    /signature is invalid/,
  );
  assert.throws(
    () => readMaintenanceCampaignState(marker + "\n" + marker, SECRET),
    /Multiple maintenance campaign state markers/,
  );
});

test("campaign state reserves one bounded iteration for dispatch", () => {
  const transition = beginMaintenanceCampaignIteration(initial(), {
    commentId: 101,
    currentHead: HEAD_A,
    maxIterations: 4,
    nowSeconds: 1_700_000_000,
  });

  assert.equal(transition.action, "dispatch");
  assert.equal(transition.state.iteration, 1);
  assert.equal(transition.state.in_flight, true);
  assert.equal(transition.state.active_comment_id, 101);
  assert.equal(transition.state.started_at, 1_700_000_000);
});

test("campaign state fails closed on stale head and concurrent work", () => {
  const stale = beginMaintenanceCampaignIteration(initial(), {
    commentId: 101,
    currentHead: HEAD_B,
    maxIterations: 4,
    nowSeconds: 1_700_000_000,
  });
  assert.equal(stale.action, "stale");

  const active = beginMaintenanceCampaignIteration(initial(), {
    commentId: 101,
    currentHead: HEAD_A,
    maxIterations: 4,
    nowSeconds: 1_700_000_000,
  }).state;
  const busy = beginMaintenanceCampaignIteration(active, {
    commentId: 102,
    currentHead: HEAD_A,
    maxIterations: 4,
    nowSeconds: 1_700_000_001,
  });
  assert.equal(busy.action, "busy");
});

test("campaign state terminalizes when max iterations are exhausted", () => {
  const state = {
    ...initial(),
    iteration: 4,
  };
  const transition = beginMaintenanceCampaignIteration(state, {
    commentId: 102,
    currentHead: HEAD_A,
    maxIterations: 4,
    nowSeconds: 1_700_000_000,
  });

  assert.equal(transition.action, "limit");
  assert.equal(transition.state.terminal, true);
  assert.equal(transition.state.iteration, 4);
});

test("completed iteration advances expected head and deduplicates its comment", () => {
  const active = beginMaintenanceCampaignIteration(initial(), {
    commentId: 101,
    currentHead: HEAD_A,
    maxIterations: 4,
    nowSeconds: 1_700_000_000,
  }).state;
  const completed = completeMaintenanceCampaignIteration(active, {
    commentId: 101,
    iteration: 1,
    expectedHead: HEAD_A,
    newHead: HEAD_B,
  });

  assert.equal(completed.expected_head, HEAD_B);
  assert.equal(completed.iteration, 1);
  assert.equal(completed.in_flight, false);
  assert.equal(completed.last_comment_id, 101);

  const duplicate = beginMaintenanceCampaignIteration(completed, {
    commentId: 101,
    currentHead: HEAD_B,
    maxIterations: 4,
    nowSeconds: 1_700_000_010,
  });
  assert.equal(duplicate.action, "duplicate");
});

test("dispatch rollback releases the lease without consuming an iteration", () => {
  const active = beginMaintenanceCampaignIteration(initial(), {
    commentId: 101,
    currentHead: HEAD_A,
    maxIterations: 4,
    nowSeconds: 1_700_000_000,
  }).state;
  const restored = abortMaintenanceCampaignIteration(active, {
    commentId: 101,
    iteration: 1,
    expectedHead: HEAD_A,
  });

  assert.equal(restored.iteration, 0);
  assert.equal(restored.in_flight, false);
  assert.equal(restored.active_comment_id, null);
  assert.equal(restored.last_comment_id, null);
});

test("prepare lease assertion binds PR, comment and exact head", () => {
  const active = beginMaintenanceCampaignIteration(initial(), {
    commentId: 101,
    currentHead: HEAD_A,
    maxIterations: 4,
    nowSeconds: 1_700_000_000,
  }).state;

  assert.equal(
    assertActiveMaintenanceCampaignJob(active, {
      pullNumber: 26,
      commentId: 101,
      headSha: HEAD_A,
    }).iteration,
    1,
  );
  assert.throws(
    () =>
      assertActiveMaintenanceCampaignJob(active, {
        pullNumber: 26,
        commentId: 102,
        headSha: HEAD_A,
      }),
    /job state is stale/,
  );
});

test("terminal completion prevents future campaign dispatches", () => {
  const active = beginMaintenanceCampaignIteration(initial(), {
    commentId: 101,
    currentHead: HEAD_A,
    maxIterations: 4,
    nowSeconds: 1_700_000_000,
  }).state;
  const terminal = completeMaintenanceCampaignIteration(active, {
    commentId: 101,
    iteration: 1,
    expectedHead: HEAD_A,
    newHead: HEAD_A,
    terminal: true,
  });

  assert.equal(terminal.terminal, true);
  assert.equal(
    beginMaintenanceCampaignIteration(terminal, {
      commentId: 102,
      currentHead: HEAD_A,
      maxIterations: 4,
      nowSeconds: 1_700_000_100,
    }).action,
    "terminal",
  );
});

test("expired campaign lease can be safely reclaimed without consuming another slot", () => {
  const active = beginMaintenanceCampaignIteration(initial(), {
    commentId: 101,
    currentHead: HEAD_A,
    maxIterations: 4,
    nowSeconds: 1_700_000_000,
  }).state;
  const recovered = beginMaintenanceCampaignIteration(active, {
    commentId: 102,
    currentHead: HEAD_A,
    maxIterations: 4,
    nowSeconds: 1_700_000_000 + 45 * 60 + 1,
  });

  assert.equal(recovered.action, "dispatch");
  assert.equal(recovered.state.iteration, 1);
  assert.equal(recovered.state.active_comment_id, 102);
  assert.equal(recovered.state.in_flight, true);
});
