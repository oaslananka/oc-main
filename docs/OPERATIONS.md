# Operations

## Architecture

`oc-main` has a lightweight VPS control plane and an ephemeral GitHub Actions worker plane.

### VPS control plane

The Ubuntu VPS runs only the webhook/controller container plus Doppler CLI inside that image. OpenCode is not executed on the VPS, target repositories are not cloned there, and the controller has no Docker socket.

Stable GitHub App webhook:

    https://webhook.oaslananka.dev/github

Logical consumer:

    /github/oc-main

### GitHub Actions worker plane

An authorized PR comment is HMAC-verified, numeric-user allowlisted, parsed into a mode/model, converted to a signed capability manifest, wrapped as `client_payload.job`, and dispatched to `oaslananka/oc-main` with repository-dispatch event `oc-run`. For an ordinary issue, only an allowlisted owner `/oc maintenance` command is accepted: trusted controller code creates a source-comment-bound branch with a marker commit and draft PR, writes HMAC-signed campaign state into the PR body, comments the issue with that PR number, reserves a bounded iteration, then dispatches the same signed PR worker flow.

The worker runs on GitHub-hosted Ubuntu and installs the real OpenCode CLI directly. Production pin is OpenCode v2 `2.0.24`; the OpenCode GitHub Action is not used.

Prepare/finalize stages may use Doppler and short-lived GitHub App installation tokens. The OpenCode process receives none of those credentials.

## Command surface

Accepted prefixes: `/oc`, `/opencode`.

Modes: `auto`, `plan`, `research`, `fix`, `apply`, `review`, `security`, `test`, `release`, `explain`, `refactor`, `ci`, `maintenance`.

Read-only modes: `plan`, `research`, `review`, `security`, `test`, `explain`.

Edit-capable modes: `auto`, `fix`, `apply`, `release`, `refactor`, `ci`, `maintenance`.

Free-tier execution uses built-in `plan` for read-only modes and built-in `build` for edit-capable modes. High-risk edit-capable jobs receive a separate read-only planning pass before implementation. Specialized behavior comes from the signed mode prompt, prepared quality context, and trusted `oc-*` skills. Custom agents/subagents are disabled because current OpenCode Console free-tier rejects them.

## OpenCode runtime isolation

The worker copies only `runtime/opencode/` into an isolated HOME and uses:

- `OPENCODE_CONFIG_PROJECT_DISABLE=1`;
- `OPENCODE_DISABLE_AUTOUPDATE=1`;
- `OPENCODE_DB=:memory:`;
- `OPENCODE_CONFIG_DIR` pinned to the isolated trusted config root.

Target `.opencode`, `.claude`, `.agents`, `opencode.json(c)`, `AGENTS.md`, `CLAUDE.md`, and related control surfaces are quarantined during execution. Tracked quarantined paths use temporary Git `skip-worktree` bits so the model does not see false deletions; original files and index flags are restored afterward.

The trusted runtime does not define custom OpenCode agents. Built-in `plan`/`build`, trusted instructions, trusted skills, global native v2 permissions, and the signed mode prompt form the runtime authority.

## Doppler configuration

Use project `oc-main`, config `main`.

Required/meaningful keys:

    PORT=8787
    WEBHOOK_PATH=/github/oc-main
    GITHUB_APP_ID=<id>
    GITHUB_APP_PRIVATE_KEY_BASE64=<base64 PEM>
    GITHUB_WEBHOOK_SECRET=<secret>
    WORKER_DISPATCH_SECRET=<random 32+ byte secret>
    CONTROL_REPOSITORY=oaslananka/oc-main
    ALLOWED_GITHUB_USER_IDS=285490571
    DEFAULT_MODEL=opencode/nemotron-3.5-lightning-free
    ALLOWED_MODELS=<comma-separated allowlist>
    OPENCODE_TIMEOUT_MS=1200000

Optional:

    GITHUB_INGRESS_PATH=/github
    DISPATCH_EVENT_TYPE=oc-run
    OPENCODE_BIN=/usr/local/bin/opencode

Do not place secret values in documentation or Context Ledger.

## Bootstrap secret boundary

GitHub repository secrets: `DOPPLER_TOKEN` only.

VPS bootstrap file: `/etc/oc-main/runtime-bootstrap`, containing a read-only Doppler service token scoped to `oc-main/main`.

## VPS deployment

Production checkout:

    /home/ubuntu/Desktop/test_all

Deploy current main:

    cd /home/ubuntu/Desktop/test_all
    git fetch origin main
    git checkout main
    git pull --ff-only origin main
    sudo ./scripts/compose.sh build
    sudo ./scripts/compose.sh up -d
    sudo ./scripts/compose.sh ps

Logs:

    sudo ./scripts/compose.sh logs -f controller

Shared Caddy config remains `/opt/oaslananka-agent/current/infra/compose/Caddyfile`; do not launch a competing Caddy on 80/443.

### Safe controller-only rollout and rollback

The VPS production checkout is owned by `ubuntu`. Perform Git commands as
`ubuntu`, not as root: root Git preflight can rewrite `.git/index` as a
root-owned file and prevent subsequent ordinary Git operations. Verify the
working tree is clean, pin the intended `main` commit SHA, fetch, require
fast-forward ancestry and stop if refs have moved. Never force-push or discard
an unexpected working-tree change.

Before building, record the exact Docker image ID of
`oc-main-webhook:local` and give it a distinct, immutable-for-this-rollout
rollback tag. Verify the tag still resolves to that image ID. The rollback
tag must not be overwritten by the new build.

Only the `scripts/compose.sh` Docker operations require the protected
root/bootstrap boundary. Where `sudo` is unavailable to an unprivileged exec
agent due to `no-new-privileges`, use an **explicitly scoped, approved VPS
privileged broker operation**; do not bypass that boundary or substitute the
separate `oaslananka-ops-mcp` production release mechanism. Validate the
bootstrap file is readable under the broker, that the external
`oaslananka-frontdoor` network exists and that the original container is
healthy before changing it. Do not print or copy the bootstrap credentials.

Build and replace **only** the controller service:

```sh
./scripts/compose.sh build controller
./scripts/compose.sh up -d --no-deps controller
./scripts/compose.sh ps
```

Observe the new container until Docker reports `healthy`; check the expected
source SHA, zero unexpected restarts, the `oc-main-github-router` network
alias, `GET /healthz` returning HTTP 200 and an intentionally unsigned
`POST /github/oc-main` returning HTTP 401. The negative-auth check must
contain no real issue/PR command or signed payload.

If build fails, the old controller should remain running; do not label the
new source deployed. If replace/health checks fail, restore the **verified
rollback image ID** from its recorded tag and recreate only the controller:

```sh
docker image tag oc-main-webhook:rollback-<previous-sha> oc-main-webhook:local
./scripts/compose.sh up -d --no-deps --force-recreate controller
```

Then recheck Docker health and webhook rejection. Restore the prior clean
checkout as `ubuntu` only after re-verifying exact refs; log the failed
attempt and leave any unrelated services/credentials/Caddy untouched.
A published release or a passing GitHub-hosted worker is not itself evidence
that the VPS image/checkout was replaced. Record both identities separately.


## GitHub Actions security boundary

- control checkout uses `persist-credentials: false`;
- trusted controller/prepare/finalize stages mint installation tokens with an explicit single-repository scope and stage-specific permissions instead of inheriting the GitHub App registration's full permission set; issue campaign bootstrap uses only `contents:write`, `issues:write`, and `pull_requests:write` on the target repository, while campaign iteration control uses `contents:read` plus `pull_requests:write`;
- OpenCode receives no Doppler/GitHub App/installation/webhook credential;
- external-directory access, unattended questions, subagents, Git push/commit/remote/config, `gh`, SSH/SCP/rsync are denied by native v2 policy;
- read-only modes cannot be pushed by the trusted finalizer;
- finalizer PR conversation comments use a target-repository token scoped to `pull_requests:write`; GitHub rejected the narrower `issues:write + pull_requests:read` profile for PR comments during production canary validation;
- finalizer requires the PR head SHA to equal the prepared snapshot and never force-pushes;
- after a successful trusted push, state completion tolerates only bounded GitHub read-after-write lag where the API still reports the exact prepared head; it polls for the exact pushed SHA at most four reads with one-second maximum delay, and any unrelated SHA or timeout fails closed;
- bot commits use the `oaslananka-ops[bot]` identity.

## Completion and quality context

The trusted prepare stage fetches bounded public Codacy PR findings when available and adds them to ordinary signed-mode prompts as untrusted evidence. Failure to fetch Codacy is soft; the task still runs with repository evidence.

For `maintenance`, prepare builds a structured evidence snapshot before OpenCode starts:

- exact candidate and base commit identities;
- candidate/base GitHub check runs and their regression/resolution state;
- live required-check names when repository rules or branch-protection metadata are readable;
- additional required check names from the base commit's `.github/maintenance-policy.yml`;
- normalized/deduplicated analyzer findings, currently with detailed public Codacy findings and provider-aware check evidence for Sonar, Codacy, Semgrep, OSV, CodeQL, Socket, Codecov, Trivy, GitGuardian and npm audit naming families;
- open dependency PR metadata for canonical `dependabot[bot]` / `renovate[bot]` GitHub Bot actors, plus read-only lane suggestions bounded by `campaign.max_dependencies_per_batch`.

The maintenance policy parser accepts only the documented bounded schema. It always requires `required_checks.inherit_from_github: true`; malformed or unsupported policy falls back to built-in defaults. The candidate PR cannot weaken its own evidence policy because the policy is read from the base SHA. In `oc-main`, the base-branch `.github/maintenance-policy.yml` additionally requires the `test` job from `.github/workflows/ci.yml`. This corrects a production canary in which a deliberately failing test was non-blocking because the check was not required by the discoverable live rules. Policy inheritance remains enabled.

Dependency PR discovery reuses the maintenance prepare token's existing `pull_requests:read` authority and adds no mutation permission. Lookalike users/noncanonical bots are ignored. Titles, labels, package hints and lane proposals are untrusted evidence. The collector never closes, retargets, supersedes, merges, comments on, or cancels dependency work.

For issue-origin campaigns, the controller also reads `campaign.max_iterations` from that base-SHA policy before each dispatch. Campaign state is stored as one hidden HMAC-signed marker in the draft PR body and binds source issue/comment, campaign PR, exact expected head, iteration, terminal/in-flight state, and trigger-comment identity. Prepare verifies the active lease before OpenCode starts. Finalize updates the same signed state after an incomplete/failure/no-change result or after a successful non-force push. Dispatch failures roll back the reservation; a reservation older than 45 minutes can be reclaimed so a controller crash cannot leave the campaign permanently busy. The generated campaign branch prefix is reserved; missing/tampered state on such a branch fails closed. A model-reported `BLOCKED:` result remains evidence/result text and does not itself set trusted terminal state.

The repository contains a pure check-aware continuation decision model. Automatic re-dispatch is wired only through a separate trusted controller reevaluation boundary; the observer itself still never calls `repository_dispatch`. It compares signed campaign state with the live PR head and a prepared evidence snapshot. Only current-head, authority-complete, settled blocking evidence is classified `retry-eligible`; pending required checks hold, stale evidence requests refresh, and missing/cancelled checks, ambiguous blocking-check cause, incomplete authority, stale campaign state, iteration-policy conflicts, exhausted budgets, or a clean settled head route to owner review. After campaign finalization, trusted finalizer code runs a bounded current-head observer and may emit scheduler phase labels to the existing sticky comment. The observer mints a separate target-repository token using the same explicit read-only maintenance scope as prepare (`administration:read`, `checks:read`, `contents:read`, `pull_requests:read`) while status writes continue through the separate `pull_requests:write` finalizer token.

Observation is bounded to at most 7 snapshots: one immediate snapshot and at most 6 additional snapshots 20 seconds apart, for a two-minute maximum settling window. Each snapshot reads the current PR head before evidence collection and re-reads it afterward. Pending required checks remain waiting. Required checks that have not registered yet receive only this bounded grace; if they are still missing at the final attempt, status becomes owner review. Retry-eligible blocking evidence updates status to `ready-remediation` and stops observation. That status alone carries a hidden wakeup identity bound to the completed iteration and exact expected head. The observer does not post a command or dispatch OpenCode. A subsequent canonical bot `issue_comment edited` webhook lets the VPS controller re-read signed state, refresh current-head evidence, re-run the continuation decision, reserve exactly one next iteration under base-policy bounds, and then use the normal signed `repository_dispatch` path. Non-ready status edits carry no wakeup marker. An exact-head clean campaign may be projected as `owner-review-ready` only after the separate pure classifier verifies complete required-check authority, explicit terminal-success required checks, consistent counts and no blocking normalized findings. This is a display-only handoff with no wakeup marker and no dispatch, GitHub draft-to-ready, approval or merge authority. Incomplete, cancelled, missing or ambiguous evidence retains waiting or `owner-review` semantics.

Issue-origin campaigns also maintain one sticky PR status comment owned by `oaslananka-ops[bot]`. The controller updates it when an iteration is reserved or dispatch is rolled back; the finalizer updates it after incomplete, failed, blocked-read-only, no-change, or pushed outcomes. The comment exposes only trusted state and bounded collector counts plus the GitHub Actions run ID. It also records the prepared evidence head and labels that snapshot current or stale relative to the campaign's expected head; a pushed commit therefore cannot inherit pre-push check readiness by implication. Selection requires both the canonical Bot actor and the hidden status marker; copied markers in human/other-bot comments are ignored, while duplicate canonical status comments cause that update to stop rather than overwrite an arbitrary comment. Status update errors are logged and are non-authoritative.

For automatically continuable issue-origin campaigns, version-2 signed state also retains the original owner-authorized maintenance task prompt and the resolved allowlisted model. Automatic jobs use manifest v3, which signs `trigger_kind=automation-status` plus the reserved campaign iteration. Prepare validates that exact lease before clone/execution. The single production controller serializes all maintenance routes for the same repository under one maintenance key; worker execution remains independently PR-scoped. Stale wakeup iteration/head identities are rejected before evidence collection. If repository dispatch fails, only that exact reservation is rolled back, and the resulting `dispatch-failed` status cannot wake automation.

No Sonar/Codacy/Codecov API credential is exposed to OpenCode. This tranche does not require new provider credentials; future authenticated collectors must stay in trusted prepare and pass only sanitized findings to the model.

OpenCode CLI output is requested as JSON and reduced to assistant text events. For `fix`, `apply`, `ci`, `release`, `refactor`, and `maintenance`, a no-change first pass triggers one bounded retry. A second no-change result is marked incomplete and the Actions run fails rather than reporting a successful no-op.

A non-zero OpenCode process is still a failure by default. The only recoverable process status is exit code `1` when stderr is empty and the complete JSON stream proves that a session error was followed by a later completed assistant turn. If a final `step_finish` event is present it must have reason `stop`; the classifier tolerates a missing final `step_finish` because OpenCode's JSON stream can omit that last event during teardown. All unexplained or malformed non-zero results fail closed, and edit-required/read-only/exact-head finalization gates remain unchanged.

## MCP

Context7 is enabled at `https://mcp.context7.com/mcp` using anonymous access with OAuth auto-discovery disabled. It is research-only and not a required CI availability gate. Never expose control-plane write credentials to an MCP inside OpenCode.

## Current limitations

- OpenCode Console free-tier currently rejects custom primary agents/custom subagent sessions; production uses built-in `build`/`plan` until upstream fixes and E2E validation permit re-enabling richer custom agents.
- Webhook delivery de-duplication is in-memory on the VPS controller; issue-origin campaign command identity is additionally persisted in signed PR metadata, so completed trigger comments are not re-dispatched after controller restart.
- Shared `/github` routing is still co-located with oc-main while it is the sole webhook consumer.
