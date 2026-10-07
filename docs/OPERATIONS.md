# Operations

## Architecture

`oc-main` has a lightweight VPS control plane and an ephemeral GitHub Actions worker plane.

### VPS control plane

The Ubuntu VPS runs only the Node.js webhook/controller container plus Doppler CLI inside that image. OpenCode is not installed or executed by the VPS service, target repositories are not cloned there, and the controller has no Docker socket.

HTTPS is terminated by the existing shared Caddy edge. Stable public GitHub App webhook:

    https://webhook.oaslananka.dev/github

The logical oc-main consumer is `/github/oc-main`.

### GitHub Actions worker plane

An authorized PR comment is HMAC-verified, numeric-user allowlisted, parsed into a mode/model, converted to a signed capability manifest, and dispatched to `oaslananka/oc-main` using `repository_dispatch` event `oc-run`.

The worker runs on GitHub-hosted Ubuntu and installs the real OpenCode CLI directly. Production runtime pin is OpenCode v2 `2.0.24`; the OpenCode GitHub Action is not used.

Prepare/finalize stages may use Doppler and short-lived GitHub App installation tokens. The OpenCode execution process receives none of those credentials.

## Command surface

Accepted prefixes: `/oc` and `/opencode`.

Modes: `auto`, `plan`, `research`, `fix`, `apply`, `review`, `security`, `test`, `release`, `explain`, `refactor`, `ci`.

`plan`, `research`, `review`, `security`, `test`, and `explain` are read-only. The trusted finalizer refuses to push tracked changes from these modes.

`model=<allowed-id>` pins an allowlisted model. `model=auto` or no model uses mode routing constrained by Doppler `ALLOWED_MODELS`.

## OpenCode v2 runtime isolation

The worker copies only `runtime/opencode/` into an isolated HOME and runs with:

- `--pure`;
- `OPENCODE_DISABLE_PROJECT_CONFIG=1`;
- `OPENCODE_DISABLE_EXTERNAL_SKILLS=1`;
- `OPENCODE_DISABLE_CLAUDE_CODE=1`;
- `OPENCODE_DISABLE_AUTOUPDATE=1`;
- `OPENCODE_DISABLE_LSP_DOWNLOAD=1`;
- `OPENCODE_DB=:memory:`.

Target project OpenCode config/plugins/agents/commands/skills cannot override the trusted runtime. Target AGENTS.md content may be read manually as untrusted conventions only.

## GitHub App event handling

`oc-main` acts only on:

- `issue_comment` action `created` when the issue is a pull request;
- `pull_request_review_comment` action `created`.

Other App events are ignored by this consumer. The shared App may keep unrelated permissions and subscriptions.

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

VPS bootstrap file: `/etc/oc-main/runtime-bootstrap` containing a read-only Doppler service token scoped to `oc-main/main`.

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

The existing shared Caddy config is `/opt/oaslananka-agent/current/infra/compose/Caddyfile`; do not launch a competing Caddy on ports 80/443.

## GitHub Actions security boundary

The control repository checkout uses `persist-credentials: false`. OpenCode receives no Doppler token, GitHub App private key, webhook secret, installation token, or persisted GitHub checkout credential.

Before pushing, the trusted finalizer requires the PR head SHA to equal the prepared snapshot. Pushes are never forced. Commits produced by the finalizer use the `oaslananka-ops[bot]` identity.

## MCP

Context7 is scaffolded but disabled in the trusted runtime. Enabling any MCP requires a deliberate least-privilege credential and permission review. Never expose control-plane write credentials to an MCP running inside OpenCode.

## Current limitations

- Webhook delivery de-duplication remains in-memory on the VPS controller.
- The shared `/github` routing implementation is currently co-located with the oc-main controller while oc-main is the sole consumer; shared multi-consumer extraction is tracked separately in Context Ledger.
