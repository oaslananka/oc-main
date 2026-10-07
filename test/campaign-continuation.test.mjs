import assert from "node:assert/strict";
import test from "node:test";
import { decideMaintenanceCampaignContinuation } from "../src/campaign-continuation.mjs";

const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);

function state(overrides = {}) {
  return {
    expected_head: HEAD_A,
    iteration: 1,
    terminal: false,
    in_flight: false,
    ...overrides,
  };
}

function evidence(overrides = {}) {
  return {
    headSha: HEAD_A,
    policy: {
      campaign: {
        max_iterations: 4,
      },
    },
    requiredChecks: {
      authorityComplete: true,
    },
    checkSummary: {
      requiredCount: 2,
      blockingCount: 0,
      pendingRequiredCount: 0,
      missingRequiredCount: 0,
    },
    findings: [],
    ...overrides,
  };
}

test("fails closed when the campaign head no longer matches GitHub", () => {
  assert.deepEqual(
    decideMaintenanceCampaignContinuation({
      state: state(),
      currentHead: HEAD_B,
      evidence: evidence({ headSha: HEAD_B }),
    }),
    {
      action: "stale-head",
      expectedHead: HEAD_A,
      currentHead: HEAD_B,
    },
  );
});

test("fails closed when prepared evidence is stale for the current head", () => {
  assert.deepEqual(
    decideMaintenanceCampaignContinuation({
      state: state(),
      currentHead: HEAD_A,
      evidence: evidence({ headSha: HEAD_B }),
    }),
    {
      action: "stale-evidence",
      currentHead: HEAD_A,
      evidenceHead: HEAD_B,
    },
  );
});

test("does not continue terminal or in-flight campaigns", () => {
  assert.equal(
    decideMaintenanceCampaignContinuation({
      state: state({ terminal: true }),
      currentHead: HEAD_A,
      evidence: evidence(),
    }).action,
    "terminal",
  );

  assert.equal(
    decideMaintenanceCampaignContinuation({
      state: state({ in_flight: true }),
      currentHead: HEAD_A,
      evidence: evidence(),
    }).action,
    "busy",
  );
});

test("stops at the policy iteration limit", () => {
  const result = decideMaintenanceCampaignContinuation({
    state: state({ iteration: 4 }),
    currentHead: HEAD_A,
    evidence: evidence(),
  });

  assert.deepEqual(result, {
    action: "iteration-limit",
    iteration: 4,
    maxIterations: 4,
  });
});

test("waits when required-check authority is incomplete", () => {
  const result = decideMaintenanceCampaignContinuation({
    state: state(),
    currentHead: HEAD_A,
    evidence: evidence({
      requiredChecks: { authorityComplete: false },
      checkSummary: {
        requiredCount: 2,
        blockingCount: 1,
        pendingRequiredCount: 0,
        missingRequiredCount: 0,
      },
    }),
  });

  assert.equal(result.action, "wait-authority");
});

test("waits for pending or missing required checks before remediation", () => {
  const pending = decideMaintenanceCampaignContinuation({
    state: state(),
    currentHead: HEAD_A,
    evidence: evidence({
      checkSummary: {
        requiredCount: 3,
        blockingCount: 1,
        pendingRequiredCount: 1,
        missingRequiredCount: 0,
      },
    }),
  });
  assert.equal(pending.action, "wait-checks");
  assert.equal(pending.pendingRequiredCount, 1);

  const missing = decideMaintenanceCampaignContinuation({
    state: state(),
    currentHead: HEAD_A,
    evidence: evidence({
      checkSummary: {
        requiredCount: 3,
        blockingCount: 0,
        pendingRequiredCount: 0,
        missingRequiredCount: 1,
      },
    }),
  });
  assert.equal(missing.action, "wait-checks");
  assert.equal(missing.missingRequiredCount, 1);
});

test("marks settled blocking checks or findings as remediation-eligible", () => {
  const checkFailure = decideMaintenanceCampaignContinuation({
    state: state(),
    currentHead: HEAD_A,
    evidence: evidence({
      checkSummary: {
        requiredCount: 2,
        blockingCount: 1,
        pendingRequiredCount: 0,
        missingRequiredCount: 0,
      },
    }),
  });
  assert.deepEqual(checkFailure, {
    action: "remediate-eligible",
    iteration: 1,
    maxIterations: 4,
    blockingCheckCount: 1,
    blockingFindingCount: 0,
  });

  const findingFailure = decideMaintenanceCampaignContinuation({
    state: state(),
    currentHead: HEAD_A,
    evidence: evidence({
      findings: [
        { blocking: true },
        { blocking: false },
      ],
    }),
  });
  assert.equal(findingFailure.action, "remediate-eligible");
  assert.equal(findingFailure.blockingFindingCount, 1);
});

test("returns owner-review only for a settled clean current head", () => {
  const result = decideMaintenanceCampaignContinuation({
    state: state(),
    currentHead: HEAD_A,
    evidence: evidence(),
  });

  assert.deepEqual(result, {
    action: "owner-review",
    iteration: 1,
    maxIterations: 4,
    requiredCount: 2,
  });
});

test("rejects malformed evidence instead of inventing scheduler state", () => {
  assert.throws(
    () =>
      decideMaintenanceCampaignContinuation({
        state: state(),
        currentHead: HEAD_A,
        evidence: evidence({
          policy: { campaign: { max_iterations: 0 } },
        }),
      }),
    /max iterations/,
  );

  assert.throws(
    () =>
      decideMaintenanceCampaignContinuation({
        state: state(),
        currentHead: HEAD_A,
        evidence: evidence({
          checkSummary: {
            requiredCount: -1,
            blockingCount: 0,
            pendingRequiredCount: 0,
            missingRequiredCount: 0,
          },
        }),
      }),
    /required check count/,
  );
});
