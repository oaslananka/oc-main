import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyCheckEvidence,
  providerForCheckName,
} from "../src/quality-checks.mjs";
import { DEFAULT_MAINTENANCE_POLICY } from "../src/maintenance-policy.mjs";

function run(name, conclusion, status = "completed") {
  return { name, status, conclusion, output: { summary: name + " summary" } };
}

test("recognizes supported analyzer check names", () => {
  assert.equal(providerForCheckName("SonarCloud Code Analysis"), "sonar");
  assert.equal(providerForCheckName("osv-scanner / osv-scan"), "osv");
  assert.equal(providerForCheckName("Analyze JavaScript / TypeScript"), "codeql");
  assert.equal(providerForCheckName("ordinary build"), "github");
});

test("compares candidate checks with base and marks required regressions blocking", () => {
  const result = classifyCheckEvidence({
    candidateRuns: [
      run("build", "failure"),
      run("osv-scanner / osv-scan", "failure"),
      run("SonarCloud Code Analysis", "success"),
    ],
    baseRuns: [
      run("build", "success"),
      run("osv-scanner / osv-scan", "success"),
      run("SonarCloud Code Analysis", "success"),
    ],
    liveRequiredCheckNames: ["build"],
    policyRequiredCheckNames: [],
    policy: DEFAULT_MAINTENANCE_POLICY,
  });

  const build = result.checks.find((item) => item.name === "build");
  const osv = result.checks.find((item) => item.name === "osv-scanner / osv-scan");
  assert.equal(build.delta, "new");
  assert.equal(build.blocking, true);
  assert.equal(osv.delta, "new");
  assert.equal(osv.blocking, true);
  assert.equal(result.summary.requiredReady, false);
});

test("missing explicit required checks fail closed", () => {
  const result = classifyCheckEvidence({
    candidateRuns: [run("build", "success")],
    baseRuns: [run("build", "success")],
    policyRequiredCheckNames: ["build", "visual-regression"],
    policy: DEFAULT_MAINTENANCE_POLICY,
  });

  const missing = result.checks.find((item) => item.name === "visual-regression");
  assert.equal(missing.state, "missing");
  assert.equal(missing.blocking, true);
  assert.equal(result.summary.missingRequiredCount, 1);
});
