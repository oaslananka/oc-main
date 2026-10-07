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

The current implementation includes the evidence/policy engine, issue-origin initializer, bounded signed campaign state, read-only dependency-PR discovery, sticky status, check-aware continuation decisions, bounded current-head observation, and a narrow automatic re-dispatch path. An allowlisted owner starts `/oc maintenance`; trusted code may continue only the same signed campaign/task when a fresh settled current-head decision is exactly `retry-eligible`. Dependency-PR mutation, Actions cancellation, automatic ready/merge transitions, and provider-write authority remain deferred.

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

## Automatic re-dispatch

Automatic continuation never treats sticky status text as authority by itself. When the bounded observer classifies settled current-head evidence as `retry-eligible`, the rendered `ready-remediation` status includes one hidden wakeup marker bound to the completed campaign iteration and exact expected head. No other status phase carries that marker.

The VPS controller accepts only a canonical `oaslananka-ops[bot]` edited PR comment that contains both the sticky-status marker and the bounded wakeup identity. It then re-reads the HMAC-signed campaign state, rejects stale iteration/head markers, refreshes current-head maintenance evidence, re-runs the trusted continuation decision, re-reads state after evidence collection, and reserves exactly one next iteration before dispatch.

The original owner-authorized maintenance task and selected allowed model are stored inside version-2 signed campaign state when the issue campaign is created. Automatic continuation reuses those signed values; it does not synthesize an owner comment and does not trust model/provider text as the new task. Legacy/manual-only campaign state remains non-automatic.

Automatic dispatch reuses the existing signed manifest plus `repository_dispatch` transport. Manifest v3 binds trigger kind and campaign iteration. Trusted prepare re-checks the active signed iteration before OpenCode starts. The single production controller serializes all maintenance routing for a repository under one maintenance key, while GitHub Actions worker concurrency remains PR-scoped; that controller lock plus the signed state reservation prevents duplicate/stale owner and automation routes from creating parallel iterations.

If `repository_dispatch` itself fails, trusted code rolls back only the exact reservation it created. The rollback status does not contain an automatic wakeup marker, so a dispatch outage cannot create an unbounded self-retry loop. Max-iteration policy is re-read from the PR base before each reservation.

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

Provider messages, repository text, dependency-bot titles/labels, and model output are not copied into the sticky status. They remain evidence only. Prepared evidence is tied to its exact collected head. If finalization pushes a new commit, the status explicitly marks that pre-push evidence snapshot stale for the new expected head rather than implying current-head readiness.

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

For `oc-main` itself, the protected base policy explicitly adds the `test` job from `.github/workflows/ci.yml`. A failed `test` check must be classified as a required blocker after all required checks settle; unknown or nonrequired workflow failures do not independently authorize automatic re-dispatch.

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

## Check-aware continuation decision model

oc-main includes a pure trusted decision function for future campaign continuation. This tranche does not poll GitHub, schedule timers, post owner commands, or dispatch another OpenCode worker automatically.

The decision model consumes signed campaign state, the live current PR head, the base-policy iteration bound, and one prepared maintenance evidence snapshot. It evaluates, in fail-closed order:

1. terminal or in-flight signed state;
2. exact campaign-head equality;
3. iteration-policy and budget bounds;
4. evidence presence and exact-head freshness;
5. complete required-check authority;
6. missing or pending required checks;
7. required-check summary consistency;
8. settled blocking checks/findings;
9. a clean settled head.

Only a current-head, authority-complete, settled snapshot with blocking checks or blocking normalized findings is classified `retry-eligible`. Classification is not dispatch authority.

Conservative outcomes are explicit:

- active iteration → hold;
- no/stale evidence → refresh evidence;
- pending required checks → hold / waiting for checks;
- missing or cancelled required checks, incomplete authority, or ambiguous blocking-check cause → owner review;
- stale signed campaign head → owner review;
- exhausted/conflicting iteration policy → owner review;
- clean settled head → owner review.

The sticky renderer understands `waiting-checks`, `ready-remediation`, and `owner-review` phases. Trusted finalizer code now emits those phases through a bounded current-head observer after a campaign iteration completes.

The observer:

- mints a separate installation token with only `administration:read`, `checks:read`, `contents:read`, and `pull_requests:read`;
- takes one fresh snapshot immediately and at most six more snapshots 20 seconds apart (a two-minute settling window);
- re-reads the PR head after each evidence collection so a head change fails closed through the decision contract;
- treats pending required checks as waiting;
- gives newly missing required checks only the same bounded registration grace, then routes persistent missing checks to owner review;
- stops immediately on settled owner-review or retry-eligible evidence;
- updates only the existing sticky status surface.

A `ready-remediation` status is still classification only. The observer never posts a synthetic owner command, calls repository dispatch, starts OpenCode, cancels Actions, mutates dependency PRs, or increments campaign iteration state.

## Deferred campaign orchestration

The issue-origin initializer is implemented, but the following remain intentionally out of scope:

- mutating, closing, retargeting, or superseding dependency-bot PRs after the implemented read-only discovery/lane-proposal step;
- automatically closing superseded dependency PRs;
- broad automatic scheduling beyond the existing exact-head, signed-state retry-eligible wakeup path;
- cancelling GitHub Actions runs;
- changing draft/ready state;
- merging a maintenance pull request.

Those actions require a separate trusted initializer/orchestrator with explicit GitHub permissions and bounded state transitions.
