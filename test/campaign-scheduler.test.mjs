import assert from "node:assert/strict";
import test from "node:test";
import { decideMaintenanceCampaignContinuation } from "../src/campaign-scheduler.mjs";

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
    requiredChecks: { authorityComplete: true },
    checkSummary: {
      requiredCount: 2,
      blockingCount: 0,
      pendingRequiredCount: 0,
      missingRequiredCount: 0,
      requiredReady: true,
    },
    checks: [
      {
        name: "build",
        state: "success",
        blocking: false,
        requiredBy: ["github-live"],
      },
      {
        name: "security",
        state: "success",
        blocking: false,
        requiredBy: ["analyzer-policy"],
      },
    ],
    findings: [],
    ...overrides,
  };
}

function decide(options = {}) {
  return decideMaintenanceCampaignContinuation({
    state: state(),
    currentHead: HEAD_A,
    maxIterations: 4,
    evidence: evidence(),
    ...options,
  });
}

test("holds while a trusted campaign iteration is in flight", () => {
  const result = decide({
    state: state({ in_flight: true }),
  });
  assert.equal(result.action, "hold");
  assert.equal(result.reason, "iteration-in-flight");
  assert.equal(result.statusPhase, "dispatching");
  assert.equal(result.dispatchEligible, false);
});

test("fails closed to owner review when signed campaign head is stale", () => {
  const result = decide({ currentHead: HEAD_B });
  assert.equal(result.action, "owner-review");
  assert.equal(result.reason, "campaign-head-stale");
  assert.equal(result.requiresEvidenceRefresh, true);
  assert.equal(result.dispatchEligible, false);
});

test("requests current-head evidence when no prepared snapshot exists", () => {
  const result = decide({ evidence: null });
  assert.equal(result.action, "refresh-evidence");
  assert.equal(result.reason, "evidence-missing");
  assert.equal(result.statusPhase, "waiting-checks");
  assert.equal(result.dispatchEligible, false);
});

test("rejects stale prepared evidence after the head changes", () => {
  const result = decide({
    evidence: evidence({ headSha: HEAD_B }),
  });
  assert.equal(result.action, "refresh-evidence");
  assert.equal(result.reason, "evidence-stale");
  assert.equal(result.requiresEvidenceRefresh, true);
});

test("requires owner review when required-check authority is incomplete", () => {
  const result = decide({
    evidence: evidence({
      requiredChecks: { authorityComplete: false },
    }),
  });
  assert.equal(result.action, "owner-review");
  assert.equal(result.reason, "required-check-authority-incomplete");
});

test("holds while required checks are still pending", () => {
  const result = decide({
    evidence: evidence({
      checkSummary: {
        requiredCount: 2,
        blockingCount: 0,
        pendingRequiredCount: 1,
        missingRequiredCount: 0,
        requiredReady: false,
      },
    }),
  });
  assert.equal(result.action, "hold");
  assert.equal(result.reason, "required-checks-pending");
  assert.equal(result.statusPhase, "waiting-checks");
});

test("missing required checks require owner review rather than auto retry", () => {
  const result = decide({
    evidence: evidence({
      checkSummary: {
        requiredCount: 2,
        blockingCount: 1,
        pendingRequiredCount: 0,
        missingRequiredCount: 1,
        requiredReady: false,
      },
    }),
  });
  assert.equal(result.action, "owner-review");
  assert.equal(result.reason, "required-checks-missing");
  assert.equal(result.dispatchEligible, false);
});

test("cancelled required checks require owner review", () => {
  const result = decide({
    evidence: evidence({
      checkSummary: {
        requiredCount: 2,
        blockingCount: 1,
        pendingRequiredCount: 0,
        missingRequiredCount: 0,
        requiredReady: false,
      },
      checks: [
        {
          name: "build",
          state: "cancelled",
          blocking: true,
          requiredBy: ["github-live"],
        },
        {
          name: "security",
          state: "success",
          blocking: false,
          requiredBy: ["analyzer-policy"],
        },
      ],
    }),
  });
  assert.equal(result.action, "owner-review");
  assert.equal(result.reason, "required-checks-cancelled");
  assert.equal(result.dispatchEligible, false);
});

test("ambiguous blocking summary requires owner review", () => {
  const result = decide({
    evidence: evidence({
      checkSummary: {
        requiredCount: 2,
        blockingCount: 1,
        pendingRequiredCount: 0,
        missingRequiredCount: 0,
        requiredReady: false,
      },
      checks: [],
    }),
  });
  assert.equal(result.action, "owner-review");
  assert.equal(result.reason, "blocking-check-cause-ambiguous");
});

test("settled current-head blocking evidence is retry eligible", () => {
  const result = decide({
    evidence: evidence({
      checkSummary: {
        requiredCount: 2,
        blockingCount: 1,
        pendingRequiredCount: 0,
        missingRequiredCount: 0,
        requiredReady: false,
      },
      checks: [
        {
          name: "build",
          state: "failure",
          blocking: true,
          requiredBy: ["github-live"],
        },
        {
          name: "security",
          state: "success",
          blocking: false,
          requiredBy: ["analyzer-policy"],
        },
      ],
      findings: [{ blocking: true }, { blocking: false }],
    }),
  });
  assert.equal(result.action, "retry-eligible");
  assert.equal(result.reason, "blocking-regression");
  assert.equal(result.statusPhase, "ready-remediation");
  assert.equal(result.dispatchEligible, true);
  assert.equal(result.blockingChecks, 1);
  assert.equal(result.blockingFindings, 1);
});

test("blocking findings alone are retry eligible after required checks settle", () => {
  const result = decide({
    evidence: evidence({
      findings: [{ blocking: true }],
    }),
  });
  assert.equal(result.action, "retry-eligible");
  assert.equal(result.reason, "blocking-regression");
  assert.equal(result.blockingChecks, 0);
  assert.equal(result.blockingFindings, 1);
});

test("clean settled current-head evidence routes to owner review", () => {
  const result = decide();
  assert.equal(result.action, "owner-review");
  assert.equal(result.reason, "clean-settled-head");
  assert.equal(result.statusPhase, "owner-review");
  assert.equal(result.dispatchEligible, false);
});

test("exhausted iteration budget routes to terminal owner review", () => {
  const result = decide({
    state: state({ iteration: 4 }),
  });
  assert.equal(result.action, "owner-review");
  assert.equal(result.reason, "iteration-limit");
  assert.equal(result.terminal, true);
});

test("policy reduction below completed iteration requires owner review", () => {
  const result = decideMaintenanceCampaignContinuation({
    state: state({ iteration: 4 }),
    currentHead: HEAD_A,
    maxIterations: 3,
    evidence: evidence(),
  });
  assert.equal(result.action, "owner-review");
  assert.equal(result.reason, "iteration-policy-conflict");
  assert.equal(result.terminal, true);
});

test("signed terminal campaign state routes to owner review", () => {
  const result = decide({
    state: state({ terminal: true }),
  });
  assert.equal(result.action, "owner-review");
  assert.equal(result.reason, "campaign-terminal");
  assert.equal(result.terminal, true);
});

test("inconsistent settled required-check state fails closed", () => {
  const result = decide({
    evidence: evidence({
      checkSummary: {
        requiredCount: 2,
        blockingCount: 0,
        pendingRequiredCount: 0,
        missingRequiredCount: 0,
        requiredReady: false,
      },
    }),
  });
  assert.equal(result.action, "owner-review");
  assert.equal(result.reason, "required-check-state-inconsistent");
});

test("rejects invalid scheduler identity and iteration bounds", () => {
  assert.throws(
    () =>
      decideMaintenanceCampaignContinuation({
        state: state({ expected_head: "bad" }),
        currentHead: HEAD_A,
        maxIterations: 4,
        evidence: evidence(),
      }),
    /expected head/,
  );
  assert.throws(
    () =>
      decideMaintenanceCampaignContinuation({
        state: state({ iteration: 9 }),
        currentHead: HEAD_A,
        maxIterations: 9,
        evidence: evidence(),
      }),
    /iteration bound/,
  );
});
