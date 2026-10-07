import assert from "node:assert/strict";
import test from "node:test";
import {
  MAINTENANCE_CAMPAIGN_STATUS_MARKER,
  renderMaintenanceCampaignStatus,
  selectMaintenanceCampaignStatusComment,
} from "../src/campaign-status.mjs";

function state(overrides = {}) {
  return {
    source_issue: 31,
    campaign_pr: 32,
    expected_head: "a".repeat(40),
    iteration: 1,
    terminal: false,
    in_flight: true,
    ...overrides,
  };
}

test("renders only trusted campaign identity and bounded collector summaries", () => {
  const text = renderMaintenanceCampaignStatus({
    state: state(),
    maxIterations: 4,
    phase: "dispatching",
    workerRunId: 37613163660,
    evidence: {
      headSha: "a".repeat(40),
      requiredChecks: { authorityComplete: true },
      checkSummary: {
        requiredCount: 3,
        blockingCount: 1,
        pendingRequiredCount: 1,
        missingRequiredCount: 0,
      },
      findings: [
        { blocking: true, message: "untrusted provider text" },
        { blocking: false, message: "more untrusted provider text" },
      ],
      dependencyPullRequests: [
        { title: "untrusted bot title" },
        { title: "another untrusted bot title" },
      ],
      dependencyPlan: { lanes: [{ id: "npm:patch" }] },
    },
  });

  assert.match(text, /issue #31 → PR #32/);
  assert.match(text, /Dispatching worker/);
  assert.match(text, /1 \/ 4/);
  assert.match(text, /Prepared evidence.*current for expected head/);
  assert.match(text, /3 required; 1 blocking; 1 pending; 0 missing/);
  assert.match(text, /2 normalized; 1 blocking/);
  assert.match(text, /2 recognized; 1 proposed lane/);
  assert.match(text, /37613163660/);
  assert.ok(text.includes(MAINTENANCE_CAMPAIGN_STATUS_MARKER));
  assert.doesNotMatch(text, /untrusted provider text/);
  assert.doesNotMatch(text, /untrusted bot title/);
});

test("renders incomplete required-check authority without inventing evidence", () => {
  const text = renderMaintenanceCampaignStatus({
    state: state({ iteration: 0, in_flight: false }),
    maxIterations: 4,
    phase: "initialized",
  });
  assert.match(text, /0 required; 0 blocking; 0 pending; 0 missing; authority incomplete/);
  assert.match(text, /0 recognized; 0 proposed lane/);
});

test("marks prepared evidence stale after a pushed head changes", () => {
  const text = renderMaintenanceCampaignStatus({
    state: state({ expected_head: "b".repeat(40), in_flight: false }),
    maxIterations: 4,
    phase: "pushed",
    evidence: {
      headSha: "a".repeat(40),
      requiredChecks: { authorityComplete: true },
      checkSummary: {
        requiredCount: 2,
        blockingCount: 0,
        pendingRequiredCount: 0,
        missingRequiredCount: 0,
      },
      findings: [],
      dependencyPullRequests: [],
      dependencyPlan: { lanes: [] },
    },
  });

  assert.match(text, /Prepared evidence.*stale for expected head/);
  assert.match(text, /Expected head.*bbbbbbbbbbbb/);
});

test("rejects unknown phases and invalid identity values", () => {
  assert.throws(
    () => renderMaintenanceCampaignStatus({ state: state(), maxIterations: 4, phase: "unknown" }),
    /Invalid campaign status phase/,
  );
  assert.throws(
    () => renderMaintenanceCampaignStatus({
      state: state({ expected_head: "bad" }),
      maxIterations: 4,
      phase: "dispatching",
    }),
    /commit SHA/,
  );
});

test("selects only the canonical GitHub App bot status comment", () => {
  const comments = [
    {
      id: 1,
      user: { login: "oaslananka", type: "User" },
      body: "spoof " + MAINTENANCE_CAMPAIGN_STATUS_MARKER,
    },
    {
      id: 2,
      user: { login: "other-bot[bot]", type: "Bot" },
      body: MAINTENANCE_CAMPAIGN_STATUS_MARKER,
    },
    {
      id: 3,
      user: { login: "oaslananka-ops[bot]", type: "Bot" },
      body: "trusted\n" + MAINTENANCE_CAMPAIGN_STATUS_MARKER,
    },
  ];
  assert.equal(selectMaintenanceCampaignStatusComment(comments)?.id, 3);
});

test("fails closed when multiple trusted status comments exist", () => {
  assert.throws(
    () => selectMaintenanceCampaignStatusComment([
      {
        id: 10,
        user: { login: "oaslananka-ops[bot]", type: "Bot" },
        body: MAINTENANCE_CAMPAIGN_STATUS_MARKER,
      },
      {
        id: 11,
        user: { login: "oaslananka-ops[bot]", type: "Bot" },
        body: MAINTENANCE_CAMPAIGN_STATUS_MARKER,
      },
    ]),
    /Multiple trusted maintenance campaign status comments/,
  );
});

test("renders scheduler-owned waiting and owner-review phases", () => {
  const waiting = renderMaintenanceCampaignStatus({
    state: state({ in_flight: false }),
    maxIterations: 4,
    phase: "waiting-checks",
  });
  const ready = renderMaintenanceCampaignStatus({
    state: state({ in_flight: false }),
    maxIterations: 4,
    phase: "ready-remediation",
  });
  const review = renderMaintenanceCampaignStatus({
    state: state({ in_flight: false }),
    maxIterations: 4,
    phase: "owner-review",
  });

  assert.match(waiting, /Waiting for current-head required checks/);
  assert.match(ready, /Current-head blocking evidence is retry eligible/);
  assert.match(review, /Owner review required/);
});

test("renders only allowlisted trusted observer decision reasons", () => {
  const text = renderMaintenanceCampaignStatus({
    state: state({ in_flight: false }),
    maxIterations: 4,
    phase: "waiting-checks",
    decisionReason: "required-checks-pending",
  });
  assert.match(text, /Decision.*required-checks-pending/);

  assert.throws(
    () =>
      renderMaintenanceCampaignStatus({
        state: state({ in_flight: false }),
        maxIterations: 4,
        phase: "owner-review",
        decisionReason: "provider-says-retry",
      }),
    /Invalid campaign status decision reason/,
  );
});
