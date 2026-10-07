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
- Accepted owner commands become signed capability manifests and are sent to this repository with `repository_dispatch` event `oc-run`.
- `.github/workflows/opencode-worker.yml` runs the real OpenCode CLI on GitHub-hosted Ubuntu. Do not replace it with the OpenCode GitHub Action.
- Runtime-wide trusted OpenCode v2 configuration and `oc-*` skills live under `runtime/opencode/`.
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
- Git push/commit/remote/config commands, `gh`, SSH/SCP/rsync, external-directory access, questions, and subagent execution are denied by runtime policy as applicable.
- Never publish, tag, release, deploy, or create GitHub resources from the OpenCode process. Trusted control-plane steps own those actions.

## Command modes

`/oc` and `/opencode` support: `auto`, `plan`, `research`, `fix`, `apply`, `review`, `security`, `test`, `release`, `explain`, `refactor`, and `ci`.

- `plan`, `research`, `review`, `security`, `test`, and `explain` are signed read-only modes.
- `auto`, `fix`, `apply`, `release`, `refactor`, and `ci` may produce repository changes.
- `model=<allowed-id>` pins an allowlisted model; `model=auto` or no model uses deterministic routing constrained by Doppler `ALLOWED_MODELS`.

## GitHub/control-plane security invariants

- Preserve raw GitHub webhook body and relevant `X-GitHub-*` headers through shared ingress.
- Verify GitHub HMAC and allow only explicitly allowlisted numeric GitHub user IDs.
- Sign controller-to-worker payloads and verify age, signature, mode, risk, built-in agent, and capability profile on the worker.
- Repository dispatch transports the signed manifest as the single top-level `client_payload.job` envelope.
- Use array-based process spawning; never interpolate webhook text into a shell command.
- Re-check PR head immediately before push and never force-push.
- Do not add GitHub repository secrets other than `DOPPLER_TOKEN`.

## Change discipline

Keep control-plane changes testable and preserve the VPS/worker credential boundary. Update `docs/AGENT_PLATFORM.md` and `docs/OPERATIONS.md` when execution agents, skills, modes, OpenCode version, runtime permissions, MCPs, model routing, deployment, or webhook behavior changes.
