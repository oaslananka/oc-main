# oc-main Agent Platform

## Purpose

`oc-main` is a central engineering-agent control plane. A PR comment selects a signed mode; the VPS authenticates and dispatches the job; a GitHub-hosted ephemeral runner executes the trusted OpenCode runtime; a separate trusted finalizer owns commit/push/comment authority.

## Runtime

- OpenCode: pinned `@opencode/cli@2.0.24`.
- Invocation: `opencode run --standalone --agent <build|plan> --model <model> <signed-role-prompt>`.
- Session DB: in-memory.
- Project OpenCode discovery: disabled with `OPENCODE_CONFIG_PROJECT_DISABLE=1`.
- Project OpenCode/Claude/agent control files: physically quarantined and restored around execution.
- Trusted skills: explicit `~/.config/opencode/skills` source, only `oc-*` permitted.
- Trusted instructions: explicit `~/.config/opencode/AGENTS.md`.
- LSP: disabled.
- Context7: anonymous remote MCP, no injected Context7 credential.

## Free-tier compatibility

As of October 2026, OpenCode Console free-tier rejects custom primary agents and custom subagent sessions even when the same free model works with built-in agents. Production therefore does not register custom agents.

Signed execution mapping:

| Mode | OpenCode agent | Tracked edits | Role supplied by trusted prompt |
| --- | --- | ---: | --- |
| `auto` | `build` | yes | general implementation |
| `plan` | `plan` | no | implementation planning |
| `research` | `plan` | no | current-source research |
| `fix` | `build` | yes | root-cause bug fixing |
| `apply` | `build` | yes | scoped implementation |
| `review` | `plan` | no | correctness/regression review |
| `security` | `plan` | no | threat/security review |
| `test` | `plan` | no | focused validation |
| `release` | `build` | yes | release/OIDC/provenance configuration |
| `explain` | `plan` | no | evidence-based explanation |
| `refactor` | `build` | yes | behavior-preserving refactor |
| `ci` | `build` | yes | CI/build/workflow diagnosis and repair |

Custom subagents remain globally denied. When the upstream free-tier limitation is fixed, a richer custom-agent graph may be reintroduced only after exact-version end-to-end tests.

## Signed capability manifest

Controller and worker agree on and sign/verify:

- repository / PR / comment identity;
- selected model;
- mode;
- built-in execution agent;
- risk classification;
- whether tracked edits are allowed;
- logical capability list;
- task, review context, timestamp, and nonce.

The signed job is transported in `repository_dispatch.client_payload.job`. A model cannot elevate itself from a read-only mode, and the finalizer refuses to push tracked changes from read-only jobs.

## Trusted skills and prepared context

The runtime includes trusted skills for repository changes, planning, research, review, security review, CI debugging, test strategy, release engineering, dependency upgrades, refactoring, and documentation. Role specialization is provided by these skills plus the signed mode prompt rather than custom OpenCode agent IDs.

The trusted prepare stage may also collect bounded, read-only quality evidence before OpenCode starts. Public Codacy PR findings are currently supported. Analyzer content is explicitly labeled untrusted evidence: it may describe defects, files, lines, and rules, but it cannot add authority or override control-plane instructions.

## Security boundaries

- External-directory access is denied.
- Questions are denied in unattended Actions runs.
- Project skills/config/agents are quarantined and project discovery is disabled.
- `subagent=*` is denied.
- Shell is available for repository work, while Git push/commit/remote/config and external GitHub/SSH transport commands are denied.
- OpenCode has no control-plane write credentials.
- Finalization re-checks the PR head before non-force push.
- High-risk mode prompts require an explicit self/security review.

## Model routing

Explicit `model=<id>` must be in Doppler `ALLOWED_MODELS`. Otherwise the controller chooses among allowed free models by mode and falls back to `DEFAULT_MODEL`. CI/test currently prefer the proven Nemotron free model before MiMo fallback.

## Free-tier staged execution

For high-risk edit-capable jobs, the worker performs a separate built-in `plan` pass first and feeds that read-only plan into the built-in `build` implementation pass. This provides planner/implementer separation without custom agents, which the current Console free tier rejects.

OpenCode runs with JSON output. The worker extracts actual assistant text from structured events instead of treating terminal/progress output as the final answer.

Modes that semantically require an edit (`fix`, `apply`, `ci`, `release`, `refactor`) have a completion gate. If the first implementation pass produces no tracked change, the worker performs one bounded retry. If the second pass still produces no change, the run becomes `incomplete` and the workflow fails instead of reporting a false green completion. A genuine blocker must be reported explicitly with `BLOCKED:`.

## Validation

CI verifies:

- unit/syntax tests and controller image;
- exact OpenCode v2 installation;
- resolved config and built-in `build`/`plan` policy;
- absence of registered custom runtime agents;
- trusted skill/instruction sources;
- Git transport denies and subagent deny;
- runtime isolation configuration.

Runtime changes should also receive an end-to-end free-model smoke test for one read-only and one edit-capable mode before production is considered stable.
