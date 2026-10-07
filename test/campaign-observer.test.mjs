import assert from "node:assert/strict";
import test from "node:test";
import {
  CAMPAIGN_OBSERVER_MAX_ATTEMPTS,
  observeMaintenanceCampaignCurrentHead,
} from "../src/campaign-observer.mjs";

const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);

function state(overrides = {}) {
  return {
    campaign_pr: 7,
    expected_head: HEAD_A,
    iteration: 1,
    terminal: false,
    in_flight: false,
    last_comment_id: 99,
    ...overrides,
  };
}

function pr(head = HEAD_A, campaignState = state()) {
  return {
    state: "open",
    body: JSON.stringify(campaignState),
    head: { sha: head },
    base: { sha: "c".repeat(40), ref: "main" },
  };
}

function evidence({
  head = HEAD_A,
  pending = 0,
  missing = 0,
  blocking = 0,
  requiredReady = blocking === 0 && pending === 0 && missing === 0,
  authorityComplete = true,
  findings = [],
} = {}) {
  return {
    headSha: head,
    policy: { campaign: { max_iterations: 4 } },
    requiredChecks: { authorityComplete },
    checkSummary: {
      requiredCount: 1,
      blockingCount: blocking,
      pendingRequiredCount: pending,
      missingRequiredCount: missing,
      requiredReady,
    },
    checks: [
      {
        name: "build",
        state: pending > 0 ? "pending" : blocking > 0 ? "failure" : "success",
        blocking: blocking > 0,
        requiredBy: ["github-live"],
      },
    ],
    findings,
    dependencyPullRequests: [],
    dependencyPlan: { lanes: [] },
  };
}

function observerHarness(
  evidenceSequence,
  { heads = null, campaignStates = null } = {},
) {
  let fetchIndex = 0;
  let getIndex = 0;
  const statusUpdates = [];
  const sleeps = [];
  const headSequence = heads || Array(evidenceSequence.length * 2).fill(HEAD_A);
  const stateSequence =
    campaignStates || Array(headSequence.length).fill(null).map(() => state());
  return {
    statusUpdates,
    sleeps,
    getPullRequestImpl: async () => {
      const index = Math.min(getIndex++, headSequence.length - 1);
      return pr(
        headSequence[index],
        stateSequence[Math.min(index, stateSequence.length - 1)],
      );
    },
    readCampaignStateImpl: (body) => JSON.parse(body),
    fetchMaintenanceQualityContextImpl: async () => ({
      evidence: evidenceSequence[Math.min(fetchIndex++, evidenceSequence.length - 1)],
    }),
    updateStatusImpl: async (_repository, _pull, status) => {
      statusUpdates.push(status);
      return { id: 1 };
    },
    sleepImpl: async (ms) => { sleeps.push(ms); },
  };

async function observeSupersededCampaign(campaignStates) {
  const origin = campaignStates[0];
  const harness = observerHarness([evidence()], { campaignStates });
  const result = await observeMaintenanceCampaignCurrentHead({
    repository: "owner/repo",
    pullNumber: 7,
    state: origin,
    readToken: "read",
    statusToken: "write",
    campaignStateSecret: "secret",
    attempts: 2,
    delayMs: 1,
    ...harness,
  });
  return { result, harness };
}

}

test("waits on pending checks then stops on a clean settled head", async () => {
  const harness = observerHarness([
    evidence({ pending: 1, requiredReady: false }),
    evidence(),
  ]);
  const result = await observeMaintenanceCampaignCurrentHead({
    repository: "owner/repo",
    pullNumber: 7,
    state: state(),
    readToken: "read",
    statusToken: "write",
    campaignStateSecret: "secret",
    workerRunId: 123,
    attempts: 2,
    delayMs: 5,
    ...harness,
  });

  assert.equal(result.attempt, 2);
  assert.equal(result.decision.action, "owner-review");
  assert.equal(result.decision.reason, "clean-settled-head");
  assert.deepEqual(
    harness.statusUpdates.map((status) => status.phase),
    ["waiting-checks", "owner-review"],
  );
  assert.deepEqual(harness.sleeps, [5]);
});

test("stops immediately when settled blocking evidence is retry eligible", async () => {
  const harness = observerHarness([
    evidence({ blocking: 1, requiredReady: false, findings: [{ blocking: true }] }),
  ]);
  const result = await observeMaintenanceCampaignCurrentHead({
    repository: "owner/repo",
    pullNumber: 7,
    state: state(),
    readToken: "read",
    statusToken: "write",
    campaignStateSecret: "secret",
    attempts: 4,
    delayMs: 5,
    ...harness,
  });

  assert.equal(result.attempt, 1);
  assert.equal(result.decision.action, "retry-eligible");
  assert.equal(result.decision.dispatchEligible, true);
  assert.deepEqual(harness.statusUpdates.map((status) => status.phase), [
    "ready-remediation",
  ]);
  assert.deepEqual(harness.sleeps, []);
});

test("bounds pending observation attempts and leaves waiting status", async () => {
  const harness = observerHarness([
    evidence({ pending: 1, requiredReady: false }),
  ]);
  const result = await observeMaintenanceCampaignCurrentHead({
    repository: "owner/repo",
    pullNumber: 7,
    state: state(),
    readToken: "read",
    statusToken: "write",
    campaignStateSecret: "secret",
    attempts: CAMPAIGN_OBSERVER_MAX_ATTEMPTS,
    delayMs: 1,
    ...harness,
  });

  assert.equal(result.attempt, CAMPAIGN_OBSERVER_MAX_ATTEMPTS);
  assert.equal(result.decision.action, "hold");
  assert.equal(result.decision.reason, "required-checks-pending");
  assert.equal(harness.statusUpdates.length, CAMPAIGN_OBSERVER_MAX_ATTEMPTS);
  assert.equal(harness.sleeps.length, CAMPAIGN_OBSERVER_MAX_ATTEMPTS - 1);
});

test("fails closed to owner review if the campaign head changes during observation", async () => {
  const harness = observerHarness([evidence()], {
    heads: [HEAD_A, HEAD_B],
  });
  const result = await observeMaintenanceCampaignCurrentHead({
    repository: "owner/repo",
    pullNumber: 7,
    state: state(),
    readToken: "read",
    statusToken: "write",
    campaignStateSecret: "secret",
    attempts: 2,
    delayMs: 1,
    ...harness,
  });

  assert.equal(result.decision.action, "owner-review");
  assert.equal(result.decision.reason, "campaign-head-stale");
  assert.deepEqual(harness.statusUpdates.map((status) => status.phase), [
    "owner-review",
  ]);
});

test("never exceeds trusted attempt and delay bounds", async () => {
  const harness = observerHarness([evidence()]);
  await assert.rejects(
    observeMaintenanceCampaignCurrentHead({
      repository: "owner/repo",
      pullNumber: 7,
      state: state(),
      readToken: "read",
      statusToken: "write",
    campaignStateSecret: "secret",
      attempts: CAMPAIGN_OBSERVER_MAX_ATTEMPTS + 1,
      ...harness,
    }),
    /attempt count exceeds trusted bound/,
  );
  await assert.rejects(
    observeMaintenanceCampaignCurrentHead({
      repository: "owner/repo",
      pullNumber: 7,
      state: state(),
      readToken: "read",
      statusToken: "write",
    campaignStateSecret: "secret",
      attempts: 1,
      delayMs: 20_001,
      ...harness,
    }),
    /Invalid campaign observer delay/,
  );
});

test("treats newly missing required checks as bounded settling grace", async () => {
  const harness = observerHarness([
    evidence({ missing: 1, requiredReady: false }),
    evidence(),
  ]);
  const result = await observeMaintenanceCampaignCurrentHead({
    repository: "owner/repo",
    pullNumber: 7,
    state: state(),
    readToken: "read",
    statusToken: "write",
    campaignStateSecret: "secret",
    attempts: 2,
    delayMs: 5,
    ...harness,
  });

  assert.equal(result.attempt, 2);
  assert.equal(result.decision.reason, "clean-settled-head");
  assert.deepEqual(
    harness.statusUpdates.map((status) => status.phase),
    ["waiting-checks", "owner-review"],
  );
  assert.deepEqual(harness.sleeps, [5]);
});

test("routes persistent missing required checks to owner review at the bound", async () => {
  const harness = observerHarness([
    evidence({ missing: 1, requiredReady: false }),
  ]);
  const result = await observeMaintenanceCampaignCurrentHead({
    repository: "owner/repo",
    pullNumber: 7,
    state: state(),
    readToken: "read",
    statusToken: "write",
    campaignStateSecret: "secret",
    attempts: 2,
    delayMs: 1,
    ...harness,
  });

  assert.equal(result.attempt, 2);
  assert.equal(result.decision.reason, "required-checks-missing");
  assert.deepEqual(
    harness.statusUpdates.map((status) => status.phase),
    ["waiting-checks", "owner-review"],
  );
});

test("stops without overwriting status when a newer campaign iteration starts", async () => {
  const origin = state();
  const { result, harness } = await observeSupersededCampaign([
    origin,
    state({
      iteration: 2,
      in_flight: true,
      last_comment_id: 99,
    }),
  ]);

  assert.equal(result.decision.action, "superseded");
  assert.equal(result.decision.reason, "campaign-state-advanced");
  assert.deepEqual(harness.statusUpdates, []);
  assert.deepEqual(harness.sleeps, []);
});

test("stops without status writes when signed campaign state disappears", async () => {
  const origin = state();
  const { result, harness } = await observeSupersededCampaign([
    origin,
    null,
  ]);

  assert.equal(result.decision.action, "superseded");
  assert.equal(result.decision.reason, "campaign-state-advanced");
  assert.deepEqual(harness.statusUpdates, []);
  assert.deepEqual(harness.sleeps, []);
});
