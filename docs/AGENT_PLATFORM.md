# oc-main Agent Platform

## Purpose

`oc-main` is a central engineering-agent control plane. GitHub PR comments select a signed execution mode; the VPS validates and dispatches the job; a GitHub-hosted ephemeral runner executes the trusted OpenCode runtime; a separate trusted finalizer owns Git commit/push/comment authority.

## OpenCode runtime

- Runtime line: OpenCode v2.
- Production pin: `@opencode/cli@2.0.24`.
- Installation: exact npm version through `scripts/install-opencode.sh`.
- Execution: `opencode run --agent <agent> --model <model> <prompt>`.
- Session database: in-memory.
- Auto-update: disabled.
- Project OpenCode control surfaces: physically quarantined during execution.
- External skill discovery: disabled where supported; the isolated HOME contains only trusted runtime skills.
- Claude Code compatibility discovery: disabled.
- Automatic LSP downloads: disabled; already-installed language servers may still be used.

OpenCode v2.0.24 does not reliably honor the legacy project-config disable flag for all project config surfaces. oc-main therefore does not rely on that flag as a security boundary: project OpenCode/Claude/agent control files are moved out of the repository before the v2 process starts and restored afterward. This makes target repositories data rather than runtime authority.

## Modes

| Mode | Agent | Tracked edits | Typical use |
| --- | --- | ---: | --- |
| `auto` | orchestrator | yes | general owner request |
| `plan` | planner | no | implementation plan / risk analysis |
| `research` | researcher | no | current docs / source research |
| `fix` | orchestrator | yes | bug fix |
| `apply` | orchestrator | yes | apply an approved change |
| `review` | reviewer | no | PR/code review |
| `security` | security-reviewer | no | threat/security review |
| `test` | test-engineer | no | focused validation |
| `release` | orchestrator | yes | release workflow/config changes only |
| `explain` | researcher | no | architecture/behavior explanation |
| `refactor` | orchestrator | yes | behavior-preserving refactor |
| `ci` | orchestrator | yes | CI/build/workflow repair |

Examples:

    /oc plan migrate npm publishing to OIDC
    /oc research current npm Trusted Publishing requirements
    /oc fix correct the retry race
    /oc security review the workflow permissions
    /oc ci repair the failing typecheck
    /oc model=opencode/nemotron-3-ultra-free review

## Signed capability manifest

The controller derives and signs, and the worker re-derives and verifies:

- repository / PR / comment identity;
- selected model;
- mode;
- primary agent;
- risk classification;
- whether tracked edits are allowed;
- logical capability list;
- prompt, review context, timestamp, and nonce.

A model cannot elevate itself from a read-only mode by changing job state. The trusted finalizer also refuses to push tracked changes produced by a read-only mode.

## Agent topology

`orchestrator` is the primary change agent. It cannot directly edit files or run shell commands. It delegates to bounded subagents:

- `planner` — scope, dependency and risk plan;
- `researcher` — repository plus current web/docs research;
- `implementer` — minimal code/config edits;
- `reviewer` — correctness/regression review;
- `security-reviewer` — auth/workflow/supply-chain/prompt-injection review;
- `test-engineer` — focused repository-native validation;
- `ci-debugger` — CI/build/workflow diagnosis and repair;
- `release-engineer` — release/OIDC/provenance configuration edits without publishing.

The orchestrator is instructed to cap review/fix loops at two. High-risk work routes through planning and security review; simple low-risk work can skip unnecessary phases.

## Trusted skills

Only `oc-*` skills are permitted. The runtime currently includes repository change, planning, research, review, security review, CI debugging, test strategy, release engineering, dependency upgrade, refactor, and documentation skills.

Skills are global trusted runtime files copied into the isolated worker home. Project-local skills are not loaded.

## Research

The researcher and trusted research skill may use OpenCode web search/web fetch when current facts matter. Research output should prefer official/primary sources, include URLs, and distinguish verified facts from inference.

## MCP

`runtime/opencode/opencode.json` contains a disabled Context7 remote MCP scaffold. It is intentionally disabled until a dedicated low-privilege credential/authorization path is approved. Do not pass control-plane secrets into OpenCode merely to enable an MCP.

Future MCPs should be read-only by default and registered centrally. Write-capable GitHub, deployment, secret-manager, or infrastructure MCPs must not be exposed to the OpenCode execution process; use trusted controller/finalizer actions instead.

## Model routing

Explicit `model=<id>` still requires the Doppler allowlist. Otherwise mode routing prefers a stronger free model for plan/review/security/release and a faster free model for research/test/CI, then falls back to `DEFAULT_MODEL`.

`ALLOWED_MODELS` in Doppler remains the production authority even when code contains a broader current free-model fallback list.

## Validation and upgrades

CI validates:

- Node unit/syntax tests;
- Docker controller image;
- exact OpenCode v2 install version;
- resolved trusted OpenCode config;
- trusted agent discovery;
- runtime isolation flags and trusted skill namespace.

Every OpenCode runtime/version upgrade should also receive an end-to-end PR validation covering one read-only mode and one edit mode before the new runtime is considered production-stable.
