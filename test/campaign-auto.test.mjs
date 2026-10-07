import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAutomaticMaintenanceWakeup } from "../src/campaign-auto.mjs";

const HEAD_A = "a".repeat(40);
const BASE_A = "b".repeat(40);

function state(overrides = {}) {
  return {
    version: 2,
    source_issue: 40,
    source_comment_id: 100,
    campaign_pr: 41,
    expected_head: HEAD_A,
    iteration: 1,
    terminal: false,
    in_flight: false,
    active_comment_id: null,
    last_comment_id: 100,
    started_at: null,
    auto_task_prompt: "remediate current blockers only",
    auto_model: "opencode/nemotron-3-ultra-free",
    ...overrides,
  };
}

function pr() {
  return {
    state: "open",
    body: "signed-state",
    head: { sha: HEAD_A },
    base: { sha: BASE_A, ref: "main" },
  };
}

function config() {
  return {
    workerDispatchSecret: "test-secret",
    controlRepository: "oaslananka/oc-main",
    dispatchEventType: "oc-run",
    allowedModels: new Set(["opencode/nemotron-3-ultra-free"]),
  };
}

function trigger() {
  return {
    repository: "owner/repo",
    pullNumber: 41,
    commentId: 500,
    commentUserId: 900,
    commentUserLogin: "oaslananka-ops[bot]",
    expectedIteration: 1,
    expectedHead: HEAD_A,
  };
}

function evidence() {
  return {
    headSha: HEAD_A,
    policy: { campaign: { max_iterations: 4 } },
    requiredChecks: { authorityComplete: true },
    checkSummary: {
      requiredCount: 1,
      blockingCount: 1,
      pendingRequiredCount: 0,
      missingRequiredCount: 0,
      requiredReady: false,
    },
    checks: [
      {
        name: "test",
        state: "failure",
        blocking: true,
        requiredBy: ["github-live"],
      },
    ],
    findings: [],
  };
}

function harness(overrides = {}) {
  let readCount = 0;
  const calls = {
    reserve: [],
    rollback: [],
    dispatch: [],
  };
  const campaignStates = overrides.campaignStates || [state(), state()];
  return {
    calls,
    dependencies: {
      createRepositoryInstallationTokenImpl: async () => "read-token",
      getPullRequestImpl: async () => pr(),
      readCampaignStateImpl: () =>
        campaignStates[Math.min(readCount++, campaignStates.length - 1)],
      fetchMaintenanceQualityContextImpl: async () => ({
        evidence: evidence(),
      }),
      decideContinuationImpl: () => ({
        action: "retry-eligible",
        reason: "blocking-regression",
        statusPhase: "ready-remediation",
        dispatchEligible: true,
      }),
      beginAutomaticDispatchImpl: async (_config, args) => {
        calls.reserve.push(args);
        return {
          campaign: true,
          dispatch: true,
          reason: "dispatch",
          iteration: 2,
          maxIterations: 4,
          expectedHead: HEAD_A,
          sourceIssue: 40,
          taskPrompt: state().auto_task_prompt,
          model: state().auto_model,
        };
      },
      abortDispatchImpl: async (_config, args) => {
        calls.rollback.push(args);
        return true;
      },
      dispatchRepositoryEventImpl: async (_config, repository, eventType, envelope) => {
        calls.dispatch.push({ repository, eventType, envelope });
      },
      ...overrides.dependencies,
    },
  };
}

test("fresh retry-eligible wakeup reserves and dispatches exactly one automatic iteration", async () => {
  const h = harness();
  const result = await evaluateAutomaticMaintenanceWakeup({
    config: config(),
    trigger: trigger(),
    ...h.dependencies,
  });

  assert.equal(result.dispatched, true);
  assert.equal(result.iteration, 2);
  assert.equal(h.calls.reserve.length, 1);
  assert.deepEqual(h.calls.reserve[0], {
    repository: "owner/repo",
    pullNumber: 41,
    triggerCommentId: 500,
    expectedHead: HEAD_A,
    expectedIteration: 1,
  });
  assert.equal(h.calls.dispatch.length, 1);
  const job = h.calls.dispatch[0].envelope.job;
  assert.equal(job.trigger_kind, "automation-status");
  assert.equal(job.campaign_iteration, 2);
  assert.equal(job.comment_id, 500);
  assert.equal(job.comment_user_id, 900);
  assert.equal(job.mode, "maintenance");
  assert.match(job.prompt, /trusted iteration 2\/4/);
  assert.match(job.prompt, /Original authorized maintenance task/);
});

test("non-retry decisions never reserve or dispatch", async () => {
  const h = harness({
    dependencies: {
      decideContinuationImpl: () => ({
        action: "hold",
        reason: "required-checks-pending",
        statusPhase: "waiting-checks",
        dispatchEligible: false,
      }),
    },
  });
  const result = await evaluateAutomaticMaintenanceWakeup({
    config: config(),
    trigger: trigger(),
    ...h.dependencies,
  });

  assert.equal(result.dispatched, false);
  assert.equal(result.reason, "required-checks-pending");
  assert.equal(h.calls.reserve.length, 0);
  assert.equal(h.calls.dispatch.length, 0);
});

test("legacy or model-invalid campaign state never reaches evidence dispatch", async () => {
  let evidenceCalls = 0;
  const legacy = harness({
    campaignStates: [
      {
        ...state(),
        version: 1,
        auto_task_prompt: null,
        auto_model: null,
      },
    ],
    dependencies: {
      fetchMaintenanceQualityContextImpl: async () => {
        evidenceCalls += 1;
        return { evidence: evidence() };
      },
    },
  });
  const legacyResult = await evaluateAutomaticMaintenanceWakeup({
    config: config(),
    trigger: trigger(),
    ...legacy.dependencies,
  });
  assert.equal(legacyResult.reason, "legacy-or-no-auto-task");
  assert.equal(evidenceCalls, 0);

  const invalidModel = harness();
  const invalidConfig = config();
  invalidConfig.allowedModels = new Set(["opencode/big-pickle"]);
  const modelResult = await evaluateAutomaticMaintenanceWakeup({
    config: invalidConfig,
    trigger: trigger(),
    ...invalidModel.dependencies,
  });
  assert.equal(modelResult.reason, "model-not-allowed");
  assert.equal(invalidModel.calls.reserve.length, 0);
});

test("campaign state advance during fresh evidence evaluation suppresses dispatch", async () => {
  const h = harness({
    campaignStates: [state(), state({ iteration: 2, last_comment_id: 501 })],
  });
  const result = await evaluateAutomaticMaintenanceWakeup({
    config: config(),
    trigger: trigger(),
    ...h.dependencies,
  });

  assert.equal(result.dispatched, false);
  assert.equal(result.reason, "campaign-state-advanced");
  assert.equal(h.calls.reserve.length, 0);
  assert.equal(h.calls.dispatch.length, 0);
});

test("reservation refusal suppresses repository dispatch", async () => {
  const h = harness({
    dependencies: {
      beginAutomaticDispatchImpl: async (_config, args) => {
        h.calls.reserve.push(args);
        return {
          campaign: true,
          dispatch: false,
          reason: "superseded",
          iteration: 1,
          maxIterations: 4,
          expectedHead: HEAD_A,
        };
      },
    },
  });
  const result = await evaluateAutomaticMaintenanceWakeup({
    config: config(),
    trigger: trigger(),
    ...h.dependencies,
  });

  assert.equal(result.dispatched, false);
  assert.equal(result.reason, "superseded");
  assert.equal(h.calls.dispatch.length, 0);
});

test("repository dispatch failure rolls back the exact automatic reservation", async () => {
  const h = harness({
    dependencies: {
      dispatchRepositoryEventImpl: async () => {
        throw new Error("dispatch unavailable");
      },
    },
  });

  await assert.rejects(
    evaluateAutomaticMaintenanceWakeup({
      config: config(),
      trigger: trigger(),
      ...h.dependencies,
    }),
    /dispatch unavailable/,
  );

  assert.equal(h.calls.reserve.length, 1);
  assert.deepEqual(h.calls.rollback, [
    {
      repository: "owner/repo",
      pullNumber: 41,
      commentId: 500,
      iteration: 2,
      expectedHead: HEAD_A,
      maxIterations: 4,
    },
  ]);
});

test("stale wakeup generation is rejected before evidence collection", async () => {
  let evidenceCalls = 0;
  const h = harness({
    dependencies: {
      fetchMaintenanceQualityContextImpl: async () => {
        evidenceCalls += 1;
        return { evidence: evidence() };
      },
    },
  });
  const result = await evaluateAutomaticMaintenanceWakeup({
    config: config(),
    trigger: {
      ...trigger(),
      expectedIteration: 2,
    },
    ...h.dependencies,
  });

  assert.equal(result.dispatched, false);
  assert.equal(result.reason, "stale-wakeup");
  assert.equal(evidenceCalls, 0);
  assert.equal(h.calls.reserve.length, 0);
  assert.equal(h.calls.dispatch.length, 0);
});

test("stale wakeup head is rejected before evidence collection", async () => {
  let evidenceCalls = 0;
  const h = harness({
    dependencies: {
      fetchMaintenanceQualityContextImpl: async () => {
        evidenceCalls += 1;
        return { evidence: evidence() };
      },
    },
  });
  const result = await evaluateAutomaticMaintenanceWakeup({
    config: config(),
    trigger: {
      ...trigger(),
      expectedHead: "c".repeat(40),
    },
    ...h.dependencies,
  });

  assert.equal(result.dispatched, false);
  assert.equal(result.reason, "stale-wakeup");
  assert.equal(evidenceCalls, 0);
  assert.equal(h.calls.reserve.length, 0);
  assert.equal(h.calls.dispatch.length, 0);
});
