import assert from "node:assert/strict";
import test from "node:test";
import {
  abortMaintenanceCampaignIteration,
  assertActiveMaintenanceCampaignJob,
  beginAutomaticMaintenanceCampaignIteration,
  beginMaintenanceCampaignIteration,
  completeMaintenanceCampaignIteration,
  createInitialMaintenanceCampaignState,
  isMaintenanceCampaignBranchName,
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

test("campaign branch identity is exact and reserved", () => {
  assert.equal(
    isMaintenanceCampaignBranchName("oc-maintenance-issue-23-comment-101"),
    true,
  );
  assert.equal(
    isMaintenanceCampaignBranchName("oc-maintenance-issue-23-comment-101-retry"),
    true,
  );
  assert.equal(
    isMaintenanceCampaignBranchName("feature/oc-maintenance-issue-23-comment-101"),
    false,
  );
  assert.equal(
    isMaintenanceCampaignBranchName("oc-maintenance-issue-0-comment-101"),
    false,
  );
});

test("automatic campaign metadata is signed in version 2 state", () => {
  const state = createInitialMaintenanceCampaignState({
    issueNumber: 23,
    commentId: 101,
    pullNumber: 26,
    headSha: HEAD_A,
    taskPrompt: "remediate current blockers only",
    model: "opencode/nemotron-3-ultra-free",
  });
  assert.equal(state.version, 2);
  assert.equal(state.auto_task_prompt, "remediate current blockers only");
  assert.equal(state.auto_model, "opencode/nemotron-3-ultra-free");

  const body = writeMaintenanceCampaignState("workspace", state, SECRET);
  assert.deepEqual(readMaintenanceCampaignState(body, SECRET), state);
  assert.throws(
    () =>
      readMaintenanceCampaignState(
        body.replace("workspace", "workspace tamper"),
        "different-secret",
      ),
    /signature is invalid/,
  );
});

test("oversized automatic task metadata degrades to legacy manual-only state", () => {
  const state = createInitialMaintenanceCampaignState({
    issueNumber: 23,
    commentId: 101,
    pullNumber: 26,
    headSha: HEAD_A,
    taskPrompt: "x".repeat(4_001),
    model: "opencode/nemotron-3-ultra-free",
  });
  assert.equal(state.version, 1);
  assert.equal(state.auto_task_prompt, null);
  assert.equal(state.auto_model, null);
});

test("automatic iteration reserves exactly the expected idle campaign generation", () => {
  const automatic = createInitialMaintenanceCampaignState({
    issueNumber: 23,
    commentId: 101,
    pullNumber: 26,
    headSha: HEAD_A,
    taskPrompt: "remediate current blockers",
    model: "opencode/nemotron-3-ultra-free",
  });
  const first = beginAutomaticMaintenanceCampaignIteration(automatic, {
    triggerCommentId: 500,
    currentHead: HEAD_A,
    expectedIteration: 0,
    maxIterations: 4,
    nowSeconds: 1_700_000_000,
  });
  assert.equal(first.action, "dispatch");
  assert.equal(first.state.iteration, 1);
  assert.equal(first.state.active_comment_id, 500);
  assert.equal(first.state.in_flight, true);

  assert.equal(
    beginAutomaticMaintenanceCampaignIteration(first.state, {
      triggerCommentId: 500,
      currentHead: HEAD_A,
      expectedIteration: 1,
      maxIterations: 4,
      nowSeconds: 1_700_000_001,
    }).action,
    "busy",
  );
});

test("automatic iteration fails closed on legacy, stale, superseded and exhausted state", () => {
  assert.equal(
    beginAutomaticMaintenanceCampaignIteration(initial(), {
      triggerCommentId: 500,
      currentHead: HEAD_A,
      expectedIteration: 0,
      maxIterations: 4,
      nowSeconds: 1_700_000_000,
    }).action,
    "legacy",
  );

  const automatic = createInitialMaintenanceCampaignState({
    issueNumber: 23,
    commentId: 101,
    pullNumber: 26,
    headSha: HEAD_A,
    taskPrompt: "remediate",
    model: "opencode/nemotron-3-ultra-free",
  });
  assert.equal(
    beginAutomaticMaintenanceCampaignIteration(automatic, {
      triggerCommentId: 500,
      currentHead: HEAD_B,
      expectedIteration: 0,
      maxIterations: 4,
      nowSeconds: 1_700_000_000,
    }).action,
    "stale",
  );
  assert.equal(
    beginAutomaticMaintenanceCampaignIteration(
      { ...automatic, iteration: 1 },
      {
        triggerCommentId: 500,
        currentHead: HEAD_A,
        expectedIteration: 0,
        maxIterations: 4,
        nowSeconds: 1_700_000_000,
      },
    ).action,
    "superseded",
  );
  const exhausted = {
    ...automatic,
    iteration: 4,
  };
  const limited = beginAutomaticMaintenanceCampaignIteration(exhausted, {
    triggerCommentId: 500,
    currentHead: HEAD_A,
    expectedIteration: 4,
    maxIterations: 4,
    nowSeconds: 1_700_000_000,
  });
  assert.equal(limited.action, "limit");
  assert.equal(limited.state.terminal, true);
});

test("prepare lease assertion may bind the signed campaign iteration", () => {
  const automatic = createInitialMaintenanceCampaignState({
    issueNumber: 23,
    commentId: 101,
    pullNumber: 26,
    headSha: HEAD_A,
    taskPrompt: "remediate",
    model: "opencode/nemotron-3-ultra-free",
  });
  const active = beginAutomaticMaintenanceCampaignIteration(automatic, {
    triggerCommentId: 500,
    currentHead: HEAD_A,
    expectedIteration: 0,
    maxIterations: 4,
    nowSeconds: 1_700_000_000,
  }).state;

  assert.equal(
    assertActiveMaintenanceCampaignJob(active, {
      pullNumber: 26,
      commentId: 500,
      headSha: HEAD_A,
      campaignIteration: 1,
    }).iteration,
    1,
  );
  assert.throws(
    () =>
      assertActiveMaintenanceCampaignJob(active, {
        pullNumber: 26,
        commentId: 500,
        headSha: HEAD_A,
        campaignIteration: 2,
      }),
    /job state is stale/,
  );
});
