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

The current implementation includes the evidence/policy engine, the issue-origin initializer, and bounded signed campaign state. An allowlisted owner can start `/oc maintenance` from an ordinary issue; trusted controller code creates a dedicated source-comment-bound branch and draft PR, persists signed iteration/head state in that PR, and then reuses the existing PR evidence/worker/finalizer path. Dependency-PR supersession, automatic iteration scheduling, automatic ready/merge transitions, and optional workflow cancellation remain deferred.

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

Examples:

```text
# existing PR
/oc maintenance remediate the current dependency, CI, security, and quality blockers

# ordinary issue, allowlisted owner only
/oc maintenance remediate the repository maintenance backlog without weakening gates
```

On an ordinary issue, no other `/oc` mode is accepted. The initializer does not treat the issue body as trusted instructions. It creates an empty marker commit on a branch bound to the source issue/comment identity, opens a draft PR against the repository default branch, comments the issue with the PR number, and dispatches the normal signed PR worker flow. Webhook redelivery can reuse the same open source-comment-bound PR.

## Signed campaign state and bounded iterations

Each issue-origin campaign draft PR contains one hidden HMAC-signed state marker owned by trusted oc-main code. The visible PR body remains ordinary operator-facing text; the hidden marker records:

- source issue and original source-comment identity;
- campaign PR number;
- exact expected PR head;
- current completed/reserved iteration count;
- terminal state;
- active and last trigger-comment identities;
- reservation start time.

The controller reads `campaign.max_iterations` from the current PR base SHA before every campaign dispatch. It refuses a stale expected head, a terminal campaign, a duplicate completed comment, a concurrent in-flight iteration, or an exhausted iteration budget. A dispatch reservation is rolled back when repository dispatch itself fails. Reservations older than 45 minutes may be reclaimed without consuming an extra iteration slot; any older worker that later starts will fail the prepare lease check because its active comment identity is no longer current.

Trusted prepare re-verifies the signed state and exact head before OpenCode starts. Trusted finalization re-verifies the same iteration/comment/head state and updates the marker only after the result is known. A successful push advances `expected_head` to the pushed commit. Model output, including an explicit `BLOCKED:` result, does not itself gain authority to terminalize a campaign; incomplete/failed attempts consume an iteration and may be retried by a new owner comment until the controller observes the base-policy limit. Terminal state remains trusted control-plane authority.

Campaign PRs remain maintenance workspaces. The generated `oc-maintenance-issue-…` branch namespace is reserved: if its signed marker is missing, malformed, duplicated, or has an invalid signature, controller/prepare logic fails closed rather than treating it as an ordinary PR. A signed campaign marker does not grant the model new capabilities, and a non-maintenance worker job against a campaign PR is rejected before OpenCode execution.

## Sticky campaign status

Each active issue-origin campaign maintains one controller-owned PR comment identified by a hidden v1 status marker and the canonical `oaslananka-ops[bot]` GitHub Bot identity. Controller/finalizer code updates that same comment across trusted transitions instead of appending status noise.

The status projection contains only trusted identity/count data:

- source issue and campaign PR;
- trusted phase;
- bounded iteration and exact expected-head prefix;
- required-check counts and authority-complete/incomplete state;
- normalized/blocking finding counts;
- recognized dependency-PR and proposed-lane counts;
- worker run ID when finalization runs inside GitHub Actions.

Provider messages, repository text, dependency-bot titles/labels, and model output are not copied into the sticky status. They remain evidence only.

Human comments, lookalike users, and other bot comments are never selected for overwrite even if they copy the hidden marker. If more than one canonical bot status comment exists, the status update refuses to choose between them. Status writes are observability only: a create/update failure is logged but never changes signed campaign state, iteration authority, exact-head validation, or finalizer behavior.

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

## Dependency pull request discovery

Trusted prepare now performs bounded, read-only discovery of open dependency-bot pull requests using the existing target-repository `pull_requests:read` token. It recognizes only GitHub Bot actors with the canonical logins `dependabot[bot]` and `renovate[bot]`; lookalike users or unrelated bots are ignored.

For each recognized PR, the collector preserves bounded evidence including PR number, bot kind, exact head/base SHA and refs, title, draft state, labels, ecosystem/update-scope classification when it can be established conservatively, package hint when available, and a dependency-count hint. Dependabot branch namespaces provide stronger ecosystem evidence; Renovate classifications remain `unknown` when the title/ref does not establish an ecosystem safely.

The collector also emits a read-only lane proposal bounded by the base policy's `campaign.max_dependencies_per_batch`. Major, grouped, unknown, over-bound, or otherwise uncertain PRs remain isolated. Compatible same-ecosystem minor/patch PRs may be suggested as candidate consolidation lanes, but this is planning evidence only.

Dependency PR titles, labels and inferred package/lane metadata are untrusted evidence. This discovery tranche does not close, retarget, supersede, merge, comment on, or otherwise mutate dependency PRs, and it does not add `actions:write` or any other new GitHub permission.

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

Policy may guide prioritization and strengthen expectations. Analyzer policy may stay at its built-in authority or strengthen to `required`, and `block_new` severities may only stay the same or expand. Policy never changes the signed execution capability profile, downgrades built-in analyzer defaults, or weakens live GitHub gates.

## Built-in analyzer defaults

The built-in policy treats CodeQL, OSV, Semgrep, GitGuardian, and npm audit as required analyzer families when their checks are present. Sonar and Codacy are advisory by default with high-severity new-finding thresholds. Socket is supply-chain evidence, Codecov is coverage evidence, and Trivy is conditional evidence.

Repository-native branch protection remains authoritative even when its requirements differ from these defaults.

## Fail-fast versus fail-smart

Campaign orchestration should eventually use two validation tiers rather than cancelling everything after the first failure.

A future **fast gate** should gather all inexpensive causal failures in one iteration: install/lockfile, typecheck, lint, unit tests, pre-commit, dependency audit/OSV, and repository policy checks.

Only after the fast gate passes should a **full gate** spend resources on E2E, visual regression, container work, restore drills, CodeQL/Semgrep/Trivy, and external analyzers.

Existing repository `concurrency.cancel-in-progress` behavior should be preferred before adding explicit Actions cancellation. Any future cancellation authority belongs to trusted control-plane code, never OpenCode.

## Deferred campaign orchestration

The issue-origin initializer is implemented, but the following remain intentionally out of scope:

- mutating, closing, retargeting, or superseding dependency-bot PRs after the implemented read-only discovery/lane-proposal step;
- automatically closing superseded dependency PRs;
- automatically scheduling the next campaign iteration after checks settle;
- cancelling GitHub Actions runs;
- changing draft/ready state;
- merging a maintenance pull request.

Those actions require a separate trusted initializer/orchestrator with explicit GitHub permissions and bounded state transitions.
