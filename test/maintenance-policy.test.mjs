import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MAINTENANCE_POLICY,
  parseMaintenancePolicy,
  resolveMaintenancePolicy,
} from "../src/maintenance-policy.mjs";

test("parses the bounded maintenance policy schema", () => {
  const policy = parseMaintenancePolicy(`
version: 1
campaign:
  max_iterations: 3
  max_dependencies_per_batch: 4
required_checks:
  inherit_from_github: true
  names:
    - build
    - osv-scanner / osv-scan
analyzers:
  sonar:
    policy: advisory
    block_new:
      - blocker
      - critical
  trivy:
    policy: conditional
    block_new:
      - critical
      - high
`);

  assert.equal(policy.version, 1);
  assert.equal(policy.campaign.max_iterations, 3);
  assert.deepEqual(policy.required_checks.names, [
    "build",
    "osv-scanner / osv-scan",
  ]);
  assert.deepEqual(policy.analyzers.sonar.block_new, ["blocker", "critical"]);
  assert.equal(policy.analyzers.osv.policy, "required");
});

test("policy cannot disable live GitHub required-check inheritance", () => {
  assert.throws(
    () =>
      parseMaintenancePolicy(`
version: 1
required_checks:
  inherit_from_github: false
`),
    /must remain true/,
  );
});

test("rejects unknown authority-bearing policy keys", () => {
  assert.throws(
    () =>
      parseMaintenancePolicy(`
version: 1
campaign:
  unlimited_iterations: true
`),
    /Unsupported campaign key/,
  );
});

test("invalid target policy falls back to built-in fail-closed defaults", () => {
  const result = resolveMaintenancePolicy(`
version: 1
required_checks:
  inherit_from_github: false
`, "base@abc:.github/maintenance-policy.yml");

  assert.equal(result.source, "builtin-default");
  assert.match(result.warning, /Ignored invalid maintenance policy/);
  assert.equal(result.policy.required_checks.inherit_from_github, true);
  assert.equal(
    result.policy.analyzers.osv.policy,
    DEFAULT_MAINTENANCE_POLICY.analyzers.osv.policy,
  );
});

test("accepts inline comments and quoted bounded integers", () => {
  const policy = parseMaintenancePolicy(`
version: "1" # schema version
campaign:
  max_iterations: "3" # bounded retry count
  max_dependencies_per_batch: 4
required_checks:
  inherit_from_github: true # cannot be disabled
  names:
    - build # required check
`);

  assert.equal(policy.version, 1);
  assert.equal(policy.campaign.max_iterations, 3);
  assert.equal(policy.campaign.max_dependencies_per_batch, 4);
  assert.deepEqual(policy.required_checks.names, ["build"]);
});
