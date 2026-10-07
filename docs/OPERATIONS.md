# Operations

## Architecture

`oc-main` uses two separate execution planes.

### VPS control plane

The Ubuntu VPS runs only:

- the lightweight Node.js webhook controller in Docker;
- Doppler CLI inside that controller image.

HTTPS is terminated by the VPS's existing shared Caddy edge (`compose-caddy-1`), not by a second Caddy container in this stack.

The public endpoint is:

`https://webhook.oaslananka.dev/github`

The VPS does **not** run OpenCode and does not clone or build target repositories.

The existing GitHub App may remain fully permissioned and subscribed to unrelated events for other owner systems. The controller verifies the webhook signature, then only interprets supported PR comment events. Unrelated deliveries are acknowledged and ignored.

### GitHub Actions worker plane

When the authorized owner writes `/oc` or `/opencode` on a PR, the VPS controller:

1. validates the GitHub webhook HMAC;
2. checks the numeric GitHub user ID allowlist;
3. parses the command and model allowlist;
4. signs a short-lived worker payload;
5. sends a GitHub `repository_dispatch` event to `oaslananka/oc-main`.

The `opencode-worker` workflow then runs on a GitHub-hosted Ubuntu runner. It installs and runs the real OpenCode CLI directly; it does not use `anomalyco/opencode/github`.

The worker:

1. validates the signed dispatch payload using Doppler configuration;
2. creates short-lived GitHub App installation tokens;
3. clones the target PR branch into the GitHub-hosted runner;
4. runs OpenCode with a deliberately minimal environment that does not include Doppler or GitHub App credentials;
5. checks that the PR head did not move while OpenCode was running;
6. commits and pushes any requested changes without force-pushing;
7. posts the result back to the target PR.

Target repositories do not need an `oc-main` workflow or integration file.

## GitHub App event handling

The App can keep all permissions and subscriptions required by other systems.

`oc-main` currently acts only on:

- `issue_comment` with action `created`, where the issue is a pull request;
- `pull_request_review_comment` with action `created`.

Everything else is ignored by this service.

The controller-to-worker dispatch uses event type:

`oc-run`

The GitHub App must be installed on the control repository and on each target repository that the worker should be able to read/write.

## Doppler configuration

Use Doppler project `oc-main`, config `main`.

Required keys:

```text
PORT=8787
WEBHOOK_PATH=/oaslananka-ops

GITHUB_APP_ID=<github app id>
GITHUB_APP_PRIVATE_KEY_BASE64=<base64 encoded PEM private key>
GITHUB_WEBHOOK_SECRET=<github app webhook secret>

WORKER_DISPATCH_SECRET=<random 32+ byte secret>
CONTROL_REPOSITORY=oaslananka/oc-main

ALLOWED_GITHUB_USER_IDS=285490571

DEFAULT_MODEL=opencode/nemotron-3.5-lightning-free
ALLOWED_MODELS=opencode/nemotron-3.5-lightning-free,opencode/nemotron-3-ultra-free,opencode/mimo-v2.6-flash-free,opencode/mimo-v2.5-free,opencode/muse-spark-1.3-contributor-free,opencode/big-pickle

OPENCODE_TIMEOUT_MS=1200000
```

Optional keys:

```text
DISPATCH_EVENT_TYPE=oc-run
OPENCODE_BIN=/usr/local/bin/opencode
```

Generate the worker dispatch secret, for example:

```bash
openssl rand -hex 32
```

The raw GitHub App PEM must not be committed. Store its single-line base64 representation in Doppler.

## Bootstrap secret boundary

GitHub repository secrets:

```text
DOPPLER_TOKEN
```

VPS bootstrap file:

```text
/etc/oc-main/runtime-bootstrap
```

Both contain a read-only Doppler Service Token scoped to `oc-main/main`.

All application configuration and GitHub App secrets remain in Doppler. Do not mirror them into GitHub Secrets.

## VPS deployment

The intended directory is:

```text
/home/ubuntu/Desktop/test_all
```

Prerequisites:

- Docker Engine;
- Docker Compose plugin;
- the existing external Docker network `oaslananka-frontdoor`;
- the existing shared Caddy edge attached to that network;
- Cloudflare DNS for `webhook.oaslananka.dev` pointing to the VPS.

`oc-main` must not bind host ports 80 or 443 because the existing `compose-caddy-1` already owns them.

Create the bootstrap token file:

```bash
sudo install -d -m 0700 /etc/oc-main

printf '%s' 'dp.st....' | sudo tee /etc/oc-main/runtime-bootstrap >/dev/null
sudo chown 1000:1000 /etc/oc-main/runtime-bootstrap
sudo chmod 0400 /etc/oc-main/runtime-bootstrap
```

Deploy:

```bash
cd /home/ubuntu/Desktop/test_all
git clone https://github.com/oaslananka/oc-main.git .

# Until PR #8 is merged:
git checkout infra/doppler-runtime

sudo ./scripts/compose.sh build
sudo ./scripts/compose.sh up -d
sudo ./scripts/compose.sh ps
```

Logs:

```bash
sudo ./scripts/compose.sh logs -f controller
```

The public GitHub App webhook terminates at the controller's stable `/github` ingress. The same process routes the unchanged raw body to the named `/github/oc-main` consumer, which performs the HMAC and owner-command checks. The container is attached to the existing `oaslananka-frontdoor` network as `oc-main-github-router`. Add `deploy/Caddyfile` as a site block to the shared Caddy configuration at `/opt/oaslananka-agent/current/infra/compose/Caddyfile`, then validate and reload that existing Caddy service.

Stop:

```bash
sudo ./scripts/compose.sh down
```

Start:

```bash
sudo ./scripts/compose.sh up -d
```

The controller container is intentionally lightweight. It has no OpenCode installation and no Docker socket mount.

## Cloudflare and GitHub App

Configure Cloudflare so `webhook.oaslananka.dev` resolves to the VPS. The existing shared Caddy terminates HTTPS and only proxies the exact public path `/github` to `oc-main-github-router:8787`.

The GitHub App webhook URL is the stable shared ingress:

```text
https://webhook.oaslananka.dev/oaslananka-ops
```

The `/github` ingress is the stable routing point. Today it routes only to `/github/oc-main`. Future consumers can be added without changing the GitHub App webhook URL; each consumer must receive the original raw body and GitHub headers and verify the GitHub signature independently.

## GitHub Actions security boundary

The `opencode-worker` workflow uses Doppler only in the prepare/finalize steps.

The OpenCode execution step itself receives no:

- `DOPPLER_TOKEN`;
- GitHub App private key;
- webhook secret;
- installation token;
- persisted `actions/checkout` credential.

The control repository checkout sets `persist-credentials: false`.

The target PR is revalidated before push, and pushes are never forced.

## Current limitation

Webhook delivery de-duplication is in-memory on the VPS controller and does not survive a container restart. For the initial owner-only deployment this is acceptable; a durable store can be added later if needed.
