import assert from "node:assert/strict";
import test from "node:test";
import {
  deduplicateFindings,
  isFindingBlocking,
  normalizeProviderFinding,
} from "../src/quality-normalize.mjs";
import { DEFAULT_MAINTENANCE_POLICY } from "../src/maintenance-policy.mjs";

test("normalizes Codacy added findings", () => {
  const finding = normalizeProviderFinding("codacy", {
    deltaType: "Added",
    commitIssue: {
      filePath: "src/auth.ts",
      lineNumber: 12,
      message: "Potential issue",
      patternInfo: { id: "rule-1", severityLevel: "Error" },
    },
  });

  assert.equal(finding.source, "codacy");
  assert.equal(finding.state, "new");
  assert.equal(finding.severity, "high");
  assert.equal(finding.path, "src/auth.ts");
  assert.equal(finding.line, 12);
});

test("deduplicates the same vulnerability across OSV and Trivy", () => {
  const osv = normalizeProviderFinding("osv", {
    id: "GHSA-aaaa-bbbb-cccc",
    severity: "high",
    package: { name: "demo", version: "1.0.0" },
  });
  const trivy = normalizeProviderFinding("trivy", {
    vulnerabilityId: "GHSA-aaaa-bbbb-cccc",
    severity: "critical",
    pkgName: "demo",
    installedVersion: "1.0.0",
  });

  const findings = deduplicateFindings([osv, trivy]);
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].sources.sort(), ["osv", "trivy"]);
  assert.equal(findings[0].severity, "critical");
});

test("required analyzer findings block only when new or worsened", () => {
  const newFinding = normalizeProviderFinding("osv", {
    id: "GHSA-aaaa-bbbb-cccc",
    severity: "low",
    state: "new",
    package: { name: "demo", version: "1.0.0" },
  });
  const oldFinding = { ...newFinding, state: "existing" };

  assert.equal(isFindingBlocking(newFinding, DEFAULT_MAINTENANCE_POLICY), true);
  assert.equal(isFindingBlocking(oldFinding, DEFAULT_MAINTENANCE_POLICY), false);
});
