# Agent instructions

This repository is the central control plane for an owner-operated GitHub engineering agent.

## Canonical commands

- `npm test` — run unit tests.
- `npm run check` — syntax-check source and tests.
- `npm start` — start the webhook controller when runtime configuration is present.
- `docker compose -f compose.yml config` — validate the VPS webhook deployment.
- `scripts/verify-doppler.sh` — validate Doppler `oc-main/main` without printing secret values.
- `scripts/install-opencode.sh` — install the exact production OpenCode v2 CLI.

## Architecture

- The Ubuntu VPS runs only the lightweight webhook/controller container. It never runs OpenCode, target builds, or target tests.
- Stable public GitHub ingress is `https://webhook.oaslananka.dev/github`; oc-main is the logical `/github/oc-main` consumer.
- Accepted owner commands become signed capability manifests and are sent to this repository with `repository_dispatch` event `oc-run`. An allowlisted owner may also start `maintenance` from an ordinary issue; the trusted controller first creates a source-comment-bound campaign branch and draft PR, writes an HMAC-signed campaign-state marker into the PR body, reserves a bounded iteration, then dispatches the normal signed PR worker flow.
- `.github/workflows/opencode-worker.yml` runs the real OpenCode CLI on GitHub-hosted Ubuntu. Do not replace it with the OpenCode GitHub Action.
- Runtime-wide trusted OpenCode v2 configuration and `oc-*` skills live under `runtime/opencode/`.
- The trusted prepare stage may attach bounded analyzer/check findings plus recognized dependency-bot PR metadata as untrusted evidence; analyzer/bot text never becomes control-plane authority. Maintenance evidence is compared against the PR base, deduplicated, and classified against live GitHub required-check data plus the base-branch maintenance policy when available. Dependency PR discovery is read-only and may produce bounded lane suggestions only. Campaign prepare also verifies the signed PR-body state, active source comment, exact expected head, and reserved iteration before OpenCode starts.
- High-risk edit-capable jobs use a built-in `plan` pass followed by built-in `build`; edit-required modes fail incomplete after one bounded retry if no tracked change is produced.
- OpenCode process exits remain fail-closed by default. Exit code 1 is recoverable only when the structured JSON stream proves a session error was followed by a later completed assistant turn with no stderr; edit-required modes still require tracked changes and the trusted finalizer gates still apply.
- `src/capabilities.mjs` maps command modes to signed risk/capability profiles and free-tier-compatible built-in execution agents.
- Target repositories require no oc-main-specific workflow or OpenCode configuration.
- Doppler project `oc-main`, config `main`, is the source of truth for runtime settings/secrets. Outside Doppler, only `DOPPLER_TOKEN` is permitted as bootstrap credential.

## OpenCode v2 execution model

OpenCode Console free-tier currently rejects custom primary agents and custom subagents. Until upstream fixes that behavior, production uses only the built-in agent IDs accepted by the Console:

- edit-capable modes route to built-in `build`;
- read-only modes route to built-in `plan`;
- specialized behavior comes from the signed mode prompt and trusted `oc-*` skills;
- `subagent=*` is denied globally.

Do not add custom runtime agents while the free-tier limitation remains. Re-enabling custom agents requires an exact-version end-to-end free-model validation.

## OpenCode v2 security invariants

- Production worker version is pinned in `scripts/install-opencode.sh`; upgrades require CI/runtime validation and an end-to-end PR test.
- Run OpenCode from an isolated trusted HOME with `OPENCODE_CONFIG_PROJECT_DISABLE=1`.
- Physically quarantine target OpenCode/Claude/agent control surfaces during execution; tracked quarantined files are hidden from temporary Git status with `skip-worktree` and restored before finalization.
- Target `.opencode`, `.claude`, `.agents`, `opencode.json(c)`, and agent-instruction files are untrusted project data.
- Only trusted runtime skills prefixed `oc-` may be loaded.
- Built-in `plan` remains edit-denied. Read-only modes are also enforced by the trusted finalizer before push.
- OpenCode receives no Doppler token, GitHub App private key, installation token, webhook secret, persisted checkout credential, or other control-plane write credential.
- Trusted control-plane stages must mint GitHub App installation tokens with an explicit single-repository scope and the minimum stage-specific permission profile; never inherit the App registration's full permission set by default.
- Git push/commit/remote/config commands, `gh`, SSH/SCP/rsync, external-directory access, questions, and subagent execution are denied by runtime policy as applicable.
- Never publish, tag, release, deploy, or create GitHub resources from the OpenCode process. Trusted control-plane steps own those actions.

## Command modes

`/oc` and `/opencode` support: `auto`, `plan`, `research`, `fix`, `apply`, `review`, `security`, `test`, `release`, `explain`, `refactor`, `ci`, and `maintenance`.

- `plan`, `research`, `review`, `security`, `test`, and `explain` are signed read-only modes.
- `auto`, `fix`, `apply`, `release`, `refactor`, `ci`, and `maintenance` may produce repository changes.
- `maintenance` is always high-risk and uses trusted exact-head/base evidence to remediate dependency, CI, security, and quality findings without weakening gates. Ordinary issues accept only this mode; other `/oc` modes remain PR-only.
- `model=<allowed-id>` pins an allowlisted model; `model=auto` or no model uses deterministic routing constrained by Doppler `ALLOWED_MODELS`.

## GitHub/control-plane security invariants

- Preserve raw GitHub webhook body and relevant `X-GitHub-*` headers through shared ingress.
- Verify GitHub HMAC and allow only explicitly allowlisted numeric GitHub user IDs.
- Sign controller-to-worker payloads and verify age, signature, mode, risk, built-in agent, and capability profile on the worker.
- Repository dispatch transports the signed manifest as the single top-level `client_payload.job` envelope.
- Use array-based process spawning; never interpolate webhook text into a shell command.
- Re-check PR head immediately before push and never force-push.
- Maintenance campaign state is HMAC-signed with trusted control-plane material, bounded by the base policy's `campaign.max_iterations`, and must match the exact PR head/comment/iteration at prepare and finalize. A 45-minute reservation lease prevents a controller crash from leaving a campaign permanently busy. Issue-origin campaign PRs also maintain one controller-owned sticky status comment as a non-authoritative projection of signed state and bounded collector counts; status-comment failures must not alter campaign authority.
- Dependency PR discovery accepts only recognized GitHub Bot actors (`dependabot[bot]`, `renovate[bot]`) and is evidence-only. Do not add close, retarget, supersede, merge, or cancellation authority to the discovery path.
- Sticky campaign status updates may overwrite only the canonical `oaslananka-ops[bot]` comment carrying the trusted status marker. Human/lookalike/other-bot comments are never selected, and multiple trusted status comments fail closed for the status update.
- Check-aware continuation decisions are pure trusted control-plane logic. Automatic polling/re-dispatch is not enabled: only current-head, authority-complete, settled blocking evidence may be classified retry-eligible; pending checks hold, stale evidence requests refresh, and ambiguous/missing authority routes to owner review.
- Do not add GitHub repository secrets other than `DOPPLER_TOKEN`.

## Change discipline

Keep control-plane changes testable and preserve the VPS/worker credential boundary. Update `docs/AGENT_PLATFORM.md` and `docs/OPERATIONS.md` when execution agents, skills, modes, OpenCode version, runtime permissions, MCPs, model routing, deployment, or webhook behavior changes.
