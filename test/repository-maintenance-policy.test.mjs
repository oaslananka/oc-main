import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decideMaintenanceCampaignContinuation } from "../src/campaign-scheduler.mjs";
import { classifyCheckEvidence } from "../src/quality-checks.mjs";
import { parseMaintenancePolicy } from "../src/maintenance-policy.mjs";

const policySource = readFileSync(
  new URL("../.github/maintenance-policy.yml", import.meta.url),
  "utf8",
);

test("repository maintenance policy requires the real Node test check", () => {
  const policy = parseMaintenancePolicy(policySource);
  assert.equal(policy.required_checks.inherit_from_github, true);
  assert.ok(policy.required_checks.names.includes("test"));
  assert.equal(policy.campaign.max_iterations, 4);
});

test("failed test check becomes a retry-eligible current-head blocker", () => {
  const policy = parseMaintenancePolicy(policySource);
  const checks = classifyCheckEvidence({
    candidateRuns: [{ name: "test", status: "completed", conclusion: "failure" }],
    baseRuns: [{ name: "test", status: "completed", conclusion: "success" }],
    policyRequiredCheckNames: policy.required_checks.names,
    policy,
  });
  assert.equal(checks.summary.requiredCount, 1);
  assert.equal(checks.summary.blockingCount, 1);
  assert.equal(checks.summary.pendingRequiredCount, 0);
  assert.equal(checks.summary.missingRequiredCount, 0);
  assert.equal(checks.checks[0].requiredBy.includes("repository-policy"), true);

  const head = "b".repeat(40);
  const decision = decideMaintenanceCampaignContinuation({
    state: {
      expected_head: head,
      iteration: 1,
      terminal: false,
      in_flight: false,
    },
    currentHead: head,
    maxIterations: policy.campaign.max_iterations,
    evidence: {
      headSha: head,
      requiredChecks: { authorityComplete: true },
      checks: checks.checks,
      checkSummary: checks.summary,
      findings: [],
    },
  });
  assert.equal(decision.action, "retry-eligible");
});
