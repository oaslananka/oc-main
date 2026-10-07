import assert from "node:assert/strict";
import test from "node:test";
import { classifyMaintenanceCampaignReviewReadiness } from "../src/campaign-review-readiness.mjs";

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
      candidateCount: 2,
      requiredCount: 2,
      blockingCount: 0,
      pendingRequiredCount: 0,
      missingRequiredCount: 0,
      requiredReady: true,
    },
    checks: [
      { key: "test", state: "success", status: "completed", conclusion: "success", blocking: false, requiredBy: ["repository-policy"] },
      { key: "security", state: "success", status: "completed", conclusion: "success", blocking: false, requiredBy: ["analyzer-policy"] },
    ],
    findings: [],
    ...overrides,
  };
}

function decide(overrides = {}) {
  return classifyMaintenanceCampaignReviewReadiness({
    state: state(),
    currentHead: HEAD_A,
    maxIterations: 4,
    evidence: evidence(),
    ...overrides,
  });
}

function assertNoMutationAuthority(result) {
  assert.equal(result.dispatchAuthorized, false);
  assert.equal(result.draftToReadyAuthorized, false);
  assert.equal(result.mergeAuthorized, false);
  assert.equal(Object.isFrozen(result), true);
}

test("clean, settled exact-head checks and findings permit only owner handoff", () => {
  const result = decide();
  assert.equal(result.status, "ready-for-owner-review");
  assert.equal(result.reason, "clean-settled-head");
  assert.equal(result.ownerReviewReady, true);
  assert.equal(result.iterationExhausted, false);
  assertNoMutationAuthority(result);
});

test("optional failed checks and advisory findings do not grant remediation authority", () => {
  const initial = evidence();
  const result = decide({
    evidence: evidence({
      checks: [...initial.checks, { key: "optional-lint", state: "failure", status: "completed", conclusion: "failure", blocking: false, requiredBy: [] }],
      checkSummary: { ...initial.checkSummary, candidateCount: 3 },
      findings: [{ blocking: false }],
    }),
  });
  assert.equal(result.status, "ready-for-owner-review");
  assertNoMutationAuthority(result);
});

test("blocking required failure stays in remediation, not ready", () => {
  const initial = evidence();
  const result = decide({
    evidence: evidence({
      checks: [{ ...initial.checks[0], state: "failure", blocking: true }, initial.checks[1]],
      checkSummary: { ...initial.checkSummary, blockingCount: 1, requiredReady: false },
    }),
  });
  assert.equal(result.status, "blocking-remediation");
  assert.equal(result.ownerReviewReady, false);
  assertNoMutationAuthority(result);
});

test("blocking normalized findings alone prevent owner-readiness", () => {
  const result = decide({ evidence: evidence({ findings: [{ blocking: true }] }) });
  assert.equal(result.status, "blocking-remediation");
  assert.equal(result.ownerReviewReady, false);
});

test("pending required checks wait", () => {
  const initial = evidence();
  const result = decide({
    evidence: evidence({
      checks: [{ ...initial.checks[0], state: "pending" }, initial.checks[1]],
      checkSummary: { ...initial.checkSummary, pendingRequiredCount: 1, requiredReady: false },
    }),
  });
  assert.equal(result.status, "waiting");
  assert.equal(result.reason, "required-checks-pending");
  assert.equal(result.ownerReviewReady, false);
});

test("missing required check is not clean", () => {
  const initial = evidence();
  const result = decide({
    evidence: evidence({
      checks: [{ ...initial.checks[0], state: "missing", blocking: true }, initial.checks[1]],
      checkSummary: { ...initial.checkSummary, blockingCount: 1, missingRequiredCount: 1, requiredReady: false },
    }),
  });
  assert.equal(result.status, "manual-attention");
  assert.equal(result.reason, "required-checks-missing");
});

test("cancelled required check routes to manual attention", () => {
  const initial = evidence();
  const result = decide({
    evidence: evidence({
      checks: [{ ...initial.checks[0], state: "cancelled", blocking: true }, initial.checks[1]],
      checkSummary: { ...initial.checkSummary, blockingCount: 1, requiredReady: false },
    }),
  });
  assert.equal(result.status, "manual-attention");
  assert.equal(result.reason, "required-checks-cancelled");
});

test("incomplete required-check authority cannot be review-ready", () => {
  const result = decide({ evidence: evidence({ requiredChecks: { authorityComplete: false } }) });
  assert.equal(result.reason, "required-check-authority-incomplete");
  assert.equal(result.ownerReviewReady, false);
});

test("missing and stale snapshots request evidence refresh", () => {
  assert.equal(decide({ evidence: null }).status, "refresh-evidence");
  const stale = decide({ evidence: evidence({ headSha: HEAD_B }) });
  assert.equal(stale.status, "refresh-evidence");
  assert.equal(stale.reason, "evidence-stale");
});

test("stale signed expected head is never ready", () => {
  const result = decide({ currentHead: HEAD_B });
  assert.equal(result.status, "manual-attention");
  assert.equal(result.reason, "campaign-head-stale");
});

test("in-flight campaign cannot signal owner readiness", () => {
  const result = decide({ state: state({ in_flight: true }) });
  assert.equal(result.status, "waiting");
  assert.equal(result.reason, "iteration-in-flight");
});

test("clean exhausted iteration allows owner handoff but no automation authority", () => {
  const result = decide({ state: state({ iteration: 4 }) });
  assert.equal(result.status, "ready-for-owner-review");
  assert.equal(result.iterationExhausted, true);
  assert.equal(result.continuationReason, "iteration-limit");
  assertNoMutationAuthority(result);
});

test("exhausted iteration with blockers cannot become review-ready", () => {
  const result = decide({
    state: state({ iteration: 4 }),
    evidence: evidence({ findings: [{ blocking: true }] }),
  });
  assert.equal(result.status, "manual-attention");
  assert.equal(result.reason, "iteration-limit");
  assert.equal(result.iterationExhausted, true);
  assert.equal(result.ownerReviewReady, false);
});

test("terminal and iteration-policy-conflict states never become ready", () => {
  assert.equal(decide({ state: state({ terminal: true }) }).ownerReviewReady, false);
  const conflict = decide({ state: state({ iteration: 4 }), maxIterations: 3 });
  assert.equal(conflict.reason, "iteration-policy-conflict");
  assert.equal(conflict.ownerReviewReady, false);
});

test("contradictory check summary and duplicate checks fail closed", () => {
  const initial = evidence();
  const incomplete = decide({ evidence: evidence({ checks: [initial.checks[0]] }) });
  assert.equal(incomplete.reason, "clean-evidence-inconsistent");
  assert.equal(incomplete.ownerReviewReady, false);
  const duplicate = decide({ evidence: evidence({ checks: [initial.checks[0], initial.checks[0]] }) });
  assert.equal(duplicate.ownerReviewReady, false);
});

test("unknown successful-looking required conclusion and unknown finding verdict fail closed", () => {
  const initial = evidence();
  const skipped = decide({
    evidence: evidence({ checks: [{ ...initial.checks[0], state: "success", conclusion: "skipped" }, initial.checks[1]] }),
  });
  assert.equal(skipped.reason, "clean-evidence-inconsistent");
  const unknownFinding = decide({ evidence: evidence({ findings: [{}] }) });
  assert.equal(unknownFinding.ownerReviewReady, false);
});

test("invalid campaign identities still fail closed under scheduler validation", () => {
  assert.throws(() => decide({ state: state({ expected_head: "invalid" }) }), /expected head/);
});
