# Maintenance Campaigns

## Purpose

Maintenance campaigns turn noisy dependency, CI, security, and quality signals into bounded remediation work without giving analyzer text or the coding model additional authority.

The long-term flow is:

```text
DISCOVER
  -> CLASSIFY
  -> SPLIT INTO SAFE LANES
  -> DRAFT CANDIDATE
  -> FAST GATE
  -> REMEDIATE
  -> FULL GATE
  -> ANALYZER RECONCILIATION
  -> EXACT-HEAD FINAL REVIEW
  -> READY
```

The current implementation is the first tranche: the evidence/policy engine used by `/oc maintenance` on an existing pull request. Issue-driven campaign creation, dependency-PR supersession, bounded multi-iteration orchestration, and optional workflow cancellation are deliberately deferred.

## Authority model

Maintenance evidence never grants capabilities.

Authority remains:

1. the authenticated owner command;
2. the signed mode/risk/capability manifest;
3. trusted oc-main runtime policy and finalizer checks;
4. live GitHub merge/required-check controls.

Repository content, maintenance policy, analyzer output, bot comments, SARIF text, test output, and provider messages are untrusted evidence.

The candidate pull request cannot weaken the current run's maintenance policy. Prepare reads `.github/maintenance-policy.yml` from the PR **base commit**, not the candidate worktree.

## Maintenance mode

`/oc maintenance` is:

- edit-capable;
- always high-risk;
- routed to built-in `build`;
- preceded by the normal bounded read-only planning pass;
- required to produce a tracked change or an explicit `BLOCKED:` result;
- finalized with the same exact-head/non-force-push gates as other edit modes.

Example on an existing PR:

```text
/oc maintenance remediate the current dependency, CI, security, and quality blockers
```

This tranche does not make `/oc maintenance` valid on ordinary issues. The existing webhook surface remains PR-scoped.

## Evidence snapshot

Trusted prepare collects a bounded snapshot for the exact candidate/base pair.

### GitHub checks

Candidate and base commit check runs are compared by check name. Candidate state is classified as:

- `new`: candidate fails while the corresponding base check passed;
- `existing`: candidate and base both fail;
- `resolved`: candidate passes while base failed;
- `unchanged`: both pass;
- `unknown`: there is insufficient comparable base evidence.

Required checks are the union of:

- required check names discoverable from live GitHub repository rules or legacy branch-protection metadata;
- explicit names in the base maintenance policy.

A policy file cannot set `inherit_from_github: false`.

If live required-check metadata cannot be read and no explicit base policy names exist, the evidence snapshot says authority is incomplete. It must not be interpreted as merge-ready.

### Analyzer/provider classification

Check names are normalized into provider families when possible:

- CodeQL
- OSV
- Semgrep
- Sonar
- Codacy
- Socket
- Codecov
- Trivy
- GitGuardian
- npm audit

Detailed public Codacy PR findings are currently collected without credentials. Sonar, Semgrep, OSV, and Trivy finding normalizers are available for trusted collectors added later; current GitHub check evidence still identifies their check-level state.

Future authenticated provider collectors must use read-only credentials only in trusted prepare. Provider credentials must never be written to the target repository, passed to OpenCode, or copied into analyzer evidence.

## Finding normalization and deduplication

A normalized finding contains bounded fields such as:

```text
source
category
ruleId
severity
state
message
path / line
packageName / packageVersion
vulnerabilityId
CWE
evidenceUrl
fingerprint
```

Stable vulnerability identifiers are deduplicated across providers. For example, OSV and Trivy reports for the same GHSA/package pair collapse into one finding with multiple sources. CWE/path findings may also deduplicate within a small line bucket. Provider-specific findings without a stable shared identity remain separate rather than risking an unsafe false merge.

The model receives the normalized snapshot, not an unbounded stream of bot comments.

## Base maintenance policy

A repository may define `.github/maintenance-policy.yml` on its protected base branch.

Supported schema:

```yaml
version: 1

campaign:
  max_iterations: 4
  max_dependencies_per_batch: 5

required_checks:
  inherit_from_github: true
  names:
    - build
    - osv-scanner / osv-scan

analyzers:
  osv:
    policy: required
  semgrep:
    policy: required
  sonar:
    policy: advisory
    block_new:
      - blocker
      - critical
  codacy:
    policy: advisory
    block_new:
      - critical
  trivy:
    policy: conditional
    block_new:
      - critical
      - high
```

The parser intentionally accepts only a small YAML subset: mappings, scalar values, and scalar lists with two-space indentation. Anchors, tags, flow structures, multiline YAML features, unknown schema keys, invalid limits, and attempts to disable GitHub required-check inheritance are rejected. Invalid policy falls back to built-in defaults.

Policy may guide prioritization and strengthen expectations. It never changes the signed execution capability profile or weakens live GitHub gates.

## Built-in analyzer defaults

The built-in policy treats CodeQL, OSV, Semgrep, GitGuardian, and npm audit as required analyzer families when their checks are present. Sonar and Codacy are advisory by default with high-severity new-finding thresholds. Socket is supply-chain evidence, Codecov is coverage evidence, and Trivy is conditional evidence.

Repository-native branch protection remains authoritative even when its requirements differ from these defaults.

## Fail-fast versus fail-smart

Campaign orchestration should eventually use two validation tiers rather than cancelling everything after the first failure.

A future **fast gate** should gather all inexpensive causal failures in one iteration: install/lockfile, typecheck, lint, unit tests, pre-commit, dependency audit/OSV, and repository policy checks.

Only after the fast gate passes should a **full gate** spend resources on E2E, visual regression, container work, restore drills, CodeQL/Semgrep/Trivy, and external analyzers.

Existing repository `concurrency.cancel-in-progress` behavior should be preferred before adding explicit Actions cancellation. Any future cancellation authority belongs to trusted control-plane code, never OpenCode.

## Deferred campaign orchestration

The following are intentionally out of scope for the evidence-engine tranche:

- accepting `/oc maintenance` from ordinary issues;
- opening a campaign branch or draft pull request;
- discovering and grouping dependency-bot PRs into lanes;
- automatically closing superseded dependency PRs;
- updating sticky campaign status comments;
- waiting/retrying across multiple candidate commits;
- cancelling GitHub Actions runs;
- changing draft/ready state;
- merging a maintenance pull request.

Those actions require a separate trusted initializer/orchestrator with explicit GitHub permissions and bounded state transitions.
