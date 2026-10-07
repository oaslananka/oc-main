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

An authorized PR comment is HMAC-verified, numeric-user allowlisted, parsed into a mode/model, converted to a signed capability manifest, wrapped as `client_payload.job`, and dispatched to `oaslananka/oc-main` with repository-dispatch event `oc-run`.

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

## GitHub Actions security boundary

- control checkout uses `persist-credentials: false`;
- trusted controller/prepare/finalize stages mint installation tokens with an explicit single-repository scope and stage-specific permissions instead of inheriting the GitHub App registration's full permission set;
- OpenCode receives no Doppler/GitHub App/installation/webhook credential;
- external-directory access, unattended questions, subagents, Git push/commit/remote/config, `gh`, SSH/SCP/rsync are denied by native v2 policy;
- read-only modes cannot be pushed by the trusted finalizer;
- finalizer requires the PR head SHA to equal the prepared snapshot and never force-pushes;
- bot commits use the `oaslananka-ops[bot]` identity.

## Completion and quality context

The trusted prepare stage fetches bounded public Codacy PR findings when available and adds them to ordinary signed-mode prompts as untrusted evidence. Failure to fetch Codacy is soft; the task still runs with repository evidence.

For `maintenance`, prepare builds a structured evidence snapshot before OpenCode starts:

- exact candidate and base commit identities;
- candidate/base GitHub check runs and their regression/resolution state;
- live required-check names when repository rules or branch-protection metadata are readable;
- additional required check names from the base commit's `.github/maintenance-policy.yml`;
- normalized/deduplicated analyzer findings, currently with detailed public Codacy findings and provider-aware check evidence for Sonar, Codacy, Semgrep, OSV, CodeQL, Socket, Codecov, Trivy, GitGuardian and npm audit naming families.

The maintenance policy parser accepts only the documented bounded schema. It always requires `required_checks.inherit_from_github: true`; malformed or unsupported policy falls back to built-in defaults. The candidate PR cannot weaken its own evidence policy because the policy is read from the base SHA.

No Sonar/Codacy/Codecov API credential is exposed to OpenCode. This tranche does not require new provider credentials; future authenticated collectors must stay in trusted prepare and pass only sanitized findings to the model.

OpenCode CLI output is requested as JSON and reduced to assistant text events. For `fix`, `apply`, `ci`, `release`, and `refactor`, a no-change first pass triggers one bounded retry. A second no-change result is marked incomplete and the Actions run fails rather than reporting a successful no-op.

A non-zero OpenCode process is still a failure by default. The only recoverable process status is exit code `1` when stderr is empty and the complete JSON stream proves that a session error was followed by a later completed assistant turn. If a final `step_finish` event is present it must have reason `stop`; the classifier tolerates a missing final `step_finish` because OpenCode's JSON stream can omit that last event during teardown. All unexplained or malformed non-zero results fail closed, and edit-required/read-only/exact-head finalization gates remain unchanged.

## MCP

Context7 is enabled at `https://mcp.context7.com/mcp` using anonymous access with OAuth auto-discovery disabled. It is research-only and not a required CI availability gate. Never expose control-plane write credentials to an MCP inside OpenCode.

## Current limitations

- OpenCode Console free-tier currently rejects custom primary agents/custom subagent sessions; production uses built-in `build`/`plan` until upstream fixes and E2E validation permit re-enabling richer custom agents.
- Webhook delivery de-duplication is in-memory on the VPS controller.
- Shared `/github` routing is still co-located with oc-main while it is the sole webhook consumer.
