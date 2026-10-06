# Operations

## Runtime model

`oc-main` is a central GitHub App webhook service. Target repositories do not need an `oc-main` workflow or integration file. The GitHub App must be installed on every repository the service is allowed to operate on.

The GitHub App may keep unrelated permissions and webhook subscriptions for other systems. `oc-main` only handles the event types it explicitly recognizes; unrelated webhook deliveries are acknowledged and ignored.

Production deployment uses Docker Compose on Ubuntu:

- Caddy terminates HTTPS for `webhook.oaslananka.dev`.
- The controller receives the GitHub App webhook at `/oaslananka-ops`.
- The controller reads runtime settings and secrets from Doppler `oc-main/main`.
- Each OpenCode run is executed by the real OpenCode CLI inside a short-lived Docker worker container.
- The OpenCode GitHub Action is not used.
- Free Zen models are used without a provider API key.
- GitHub and Doppler credentials remain controller-side and are not passed into the OpenCode worker.

Each accepted PR command is processed as follows:

1. Verify the GitHub webhook HMAC.
2. Require the comment author's numeric GitHub user ID to be allowlisted.
3. Require an accepted `/oc` or `/opencode` command.
4. Mint a short-lived GitHub App installation token.
5. Read the PR head repository, branch, and exact head SHA.
6. Clone that branch into a temporary job directory.
7. Start a short-lived OpenCode worker container with only the repository workspace and isolated agent home mounted.
8. Over-mount the target checkout's `.git` directory read-only inside the worker.
9. Run `opencode run --model ...` with no GitHub or Doppler credentials in the worker environment.
10. Verify the PR head has not changed while the job was running.
11. Commit any workspace change locally in the controller and push without force.
12. Post the result to the PR and remove the temporary job directory.

## GitHub App behavior

The App can remain fully permissioned and subscribed for other owner systems. `oc-main` does not depend on reducing those App-level settings.

The current `oc-main` webhook handler only interprets:

- `issue_comment` with action `created`, and only when the issue is a pull request;
- `pull_request_review_comment` with action `created`.

All other GitHub webhook event names are ignored by `oc-main`.

For accepted events, the current implementation needs these repository capabilities from the App installation:

- Contents: Read and write
- Issues: Read and write
- Pull requests: Read and write
- Metadata: Read-only

The public webhook URL is:

`https://webhook.oaslananka.dev/oaslananka-ops`

The controller health endpoint remains internal:

`GET /healthz`

## Owner-only execution

`ALLOWED_GITHUB_USER_IDS` is a required comma-separated list of numeric GitHub user IDs. There is no compiled-in fallback. If the value is absent, the service fails to start instead of accepting commands from a default identity.

For the current owner-only deployment, Doppler should contain:

```text
ALLOWED_GITHUB_USER_IDS=285490571
```

A command must begin the trimmed comment:

```text
/oc fix the failing test
```

An allowed model can be selected per comment:

```text
/oc model=opencode/big-pickle fix the failing test
```

Comments from any other GitHub user are acknowledged and ignored.

## Doppler configuration

Use Doppler project `oc-main`, config `main`. Use a read-only Service Token scoped to this single config for production. Do not use a personal or CLI token in production.

For the Docker deployment, the config must contain:

```text
PORT=8787
WEBHOOK_PATH=/oaslananka-ops
GITHUB_APP_ID=<github app id>
GITHUB_APP_PRIVATE_KEY_BASE64=<base64 encoded PEM private key>
GITHUB_WEBHOOK_SECRET=<github app webhook secret>
ALLOWED_GITHUB_USER_IDS=285490571
DEFAULT_MODEL=opencode/nemotron-3.5-lightning-free
ALLOWED_MODELS=opencode/nemotron-3.5-lightning-free,opencode/nemotron-3-ultra-free,opencode/mimo-v2.6-flash-free,opencode/mimo-v2.5-free,opencode/muse-spark-1.3-contributor-free,opencode/big-pickle
WORK_ROOT=/var/lib/oc-main/jobs
MAX_CONCURRENT_JOBS=1
OPENCODE_TIMEOUT_MS=1200000
SANDBOX_MODE=docker
OPENCODE_WORKER_IMAGE=oc-main:local
DOCKER_SOCKET=/var/run/docker.sock
```

`OPENCODE_BIN` is only required when using the legacy `bwrap` mode instead of the Docker worker mode.

The GitHub App private key should be base64-encoded as one line before being stored in Doppler. The raw PEM must not be committed.

The repository-level secret model is intentionally narrow:

```text
GitHub repository secrets:
  DOPPLER_TOKEN

Doppler oc-main/main:
  all application secrets and runtime settings
```

Do not configure Doppler GitHub sync to mirror all Doppler values into GitHub Secrets for this repository.

The `doppler-config` workflow validates the expected key names without printing their values.

## VPS Docker deployment

The intended deployment directory can be:

```text
/home/ubuntu/Desktop/test_all
```

Prerequisites:

- Ubuntu VPS
- Docker Engine
- Docker Compose plugin
- ports 80/tcp and 443/tcp+udp available for Caddy
- Cloudflare DNS record `webhook.oaslananka.dev` pointing to the VPS public IP

Before deployment, check whether another service already owns ports 80 or 443:

```bash
sudo ss -ltnp '( sport = :80 or sport = :443 )'
```

Create persistent host directories and the single Doppler bootstrap secret:

```bash
sudo install -d -m 0700 /etc/oc-main
sudo install -d -m 0700 /var/lib/oc-main /var/lib/oc-main/jobs

printf '%s' 'dp.st....' | sudo tee /etc/oc-main/doppler-token >/dev/null
sudo chmod 0600 /etc/oc-main/doppler-token
```

Deploy the repository:

```bash
cd /home/ubuntu/Desktop/test_all

git clone https://github.com/oaslananka/oc-main.git .
git checkout infra/doppler-runtime

sudo docker compose -f compose.yml build
sudo docker compose -f compose.yml up -d
sudo docker compose -f compose.yml ps
```

Until PR #8 is merged, deploy the `infra/doppler-runtime` branch. After merge, deploy `main` instead.

Follow logs with:

```bash
sudo docker compose -f compose.yml logs -f controller caddy
```

Stop the whole webhook stack with:

```bash
sudo docker compose -f compose.yml down
```

Start it again with:

```bash
sudo docker compose -f compose.yml up -d
```

The Caddy service only proxies the exact public path `/oaslananka-ops` to the controller. Other paths on this dedicated hostname return 404.

Caddy manages the HTTPS certificate automatically. If Cloudflare proxying is enabled, use an SSL/TLS mode that validates the origin certificate, such as Full (strict).

## Docker worker security boundary

The controller mounts the host Docker socket because it creates short-lived worker containers. Treat the controller container as privileged infrastructure: Docker socket access is effectively host-level container authority.

The OpenCode worker itself does **not** receive the Docker socket.

Each worker is created with:

- all Linux capabilities dropped;
- `no-new-privileges`;
- read-only container root filesystem;
- private writable `/tmp`;
- process, memory, and CPU limits;
- only the current job repository and isolated agent home mounted;
- target `.git` metadata over-mounted read-only;
- no GitHub App private key, webhook secret, installation token, or Doppler token.

The worker uses Docker's bridge network so OpenCode Zen and repository-native package/test traffic can reach the internet. Do not expose ambient cloud metadata credentials from the VPS to containers.

## Cloudflare and GitHub App cutover

In Cloudflare:

1. Create or update the DNS record for `webhook.oaslananka.dev` to the VPS public IP.
2. Ensure inbound TCP 80 and 443 reach the VPS.
3. If using Cloudflare proxy mode, keep origin TLS validation enabled.

In the existing GitHub App, set the webhook URL to:

```text
https://webhook.oaslananka.dev/oaslananka-ops
```

Do not reduce the App's unrelated permissions or subscriptions if they are used by other systems. `oc-main` filters deliveries after signature verification and ignores event types it does not own.

## Current limitation

The in-memory queue and webhook delivery de-duplication state do not survive a controller restart. This is acceptable for the first deployment, but a durable queue should be added before relying on the service for high-volume or long-running automation.
