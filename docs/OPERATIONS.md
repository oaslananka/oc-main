# Operations

## Runtime model

`oc-main` is a central GitHub App webhook service. Target repositories do not need an `oc-main` workflow or integration file. The GitHub App must be installed on every repository the service is allowed to operate on.

OpenCode is installed as a CLI on the Ubuntu host. The service does not use the OpenCode GitHub Action and does not require an OpenCode provider API key for the configured free Zen models.

Doppler project `oc-main`, config `main`, is the runtime source of truth. The application itself does not use local environment files for GitHub App credentials or operating settings. A read-only Doppler Service Token is the single bootstrap credential outside Doppler.

Each accepted PR command is processed as follows:

1. Verify the GitHub webhook HMAC.
2. Require the comment author's numeric GitHub user ID to be allowlisted.
3. Mint a short-lived GitHub App installation token.
4. Read the PR head repository, branch, and exact head SHA.
5. Clone that branch into a temporary job directory.
6. Run `opencode run --model ...` in a bubblewrap sandbox with no GitHub or Doppler credentials in the OpenCode environment.
7. Verify the PR head has not changed while the job was running.
8. Commit any workspace change locally and push without force.
9. Post the result to the PR and remove the temporary job directory.

## GitHub App permissions

Repository permissions required by the current implementation:

- Contents: Read and write
- Issues: Read and write
- Pull requests: Read and write
- Metadata: Read-only

Subscribe the App to these repository events:

- Issue comment
- Pull request review comment

The webhook URL should point to:

`POST /webhook`

Health checks can use:

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

Use Doppler project `oc-main`, config `main`. Create a **read-only Service Token** scoped to this single config for production use. Do not use a personal or CLI token in production.

The config must contain these keys:

```text
PORT=8787
GITHUB_APP_ID=<github app id>
GITHUB_APP_PRIVATE_KEY_BASE64=<base64 encoded PEM private key>
GITHUB_WEBHOOK_SECRET=<github app webhook secret>
ALLOWED_GITHUB_USER_IDS=285490571
DEFAULT_MODEL=opencode/nemotron-3.5-lightning-free
ALLOWED_MODELS=opencode/nemotron-3.5-lightning-free,opencode/nemotron-3-ultra-free,opencode/mimo-v2.6-flash-free,opencode/mimo-v2.5-free,opencode/muse-spark-1.3-contributor-free,opencode/big-pickle
OPENCODE_BIN=/usr/local/bin/opencode
WORK_ROOT=/var/lib/oc-main/jobs
MAX_CONCURRENT_JOBS=1
OPENCODE_TIMEOUT_MS=1200000
SANDBOX_MODE=bwrap
```

The GitHub App private key should be base64-encoded as one line before being stored in Doppler. The raw PEM must not be committed.

The repository-level secret model is intentionally narrow:

```text
GitHub repository secrets:
  DOPPLER_TOKEN   # only secret used by the manual Doppler validation workflow

Doppler oc-main/main:
  all application secrets and runtime settings
```

Do not configure the Doppler GitHub sync integration to mirror all Doppler values into GitHub Secrets for this repository. That would defeat the one-bootstrap-secret boundary.

Run the manual `doppler-config` workflow after adding `DOPPLER_TOKEN` to the repository. It validates the required key names without printing their values.

## Ubuntu host bootstrap

Run `scripts/bootstrap-ubuntu.sh` on the Ubuntu host. It installs the required OS packages, the pinned OpenCode CLI release, and Doppler CLI `3.76.6`. Both downloaded CLI archives are verified against pinned SHA-256 digests before installation.

Create the service user and directories:

```bash
sudo useradd --system --home /nonexistent --shell /usr/sbin/nologin ocmain || true
sudo install -d -o ocmain -g ocmain -m 0700 /var/lib/oc-main /var/lib/oc-main/jobs
sudo install -d -o root -g root -m 0755 /opt/oc-main
sudo install -d -o root -g root -m 0700 /etc/oc-main
```

Put only the read-only Doppler Service Token into the systemd credential file:

```bash
printf '%s' 'dp.st....' | sudo tee /etc/oc-main/doppler-token >/dev/null
sudo chmod 0600 /etc/oc-main/doppler-token
```

Deploy the repository contents to `/opt/oc-main`, then install and start the unit:

```bash
sudo cp deploy/oc-main.service /etc/systemd/system/oc-main.service
sudo systemctl daemon-reload
sudo systemctl enable --now oc-main
sudo systemctl status oc-main
```

At startup, systemd exposes the bootstrap token as a credential only to the wrapper. Doppler injects the `oc-main/main` values, and the wrapper removes `DOPPLER_TOKEN` before launching Node. OpenCode is started later with a separate minimal environment that excludes GitHub and Doppler credentials.

Doppler stores its encrypted fallback under `/var/lib/oc-main/doppler/fallback.json`. That path is outside the repository and is writable only by the service account.

Expose the service to GitHub over HTTPS using the reverse proxy or ingress already used by the host. Do not expose the webhook endpoint without TLS.

## Sandbox boundary

Production should keep `SANDBOX_MODE=bwrap`. `SANDBOX_MODE=none` exists only for local debugging and should not be used for webhook-driven production work.

The OpenCode process receives a minimal environment without GitHub App secrets, installation tokens, or the Doppler Service Token. The sandbox mounts the target checkout read/write and mounts system binaries and certificates read-only. Git transport remains controller-owned.

## Current limitation

The in-memory queue and webhook delivery de-duplication state do not survive a service restart. This is acceptable for the first deployment, but a durable queue should be added before relying on the service for high-volume or long-running automation.

## Host egress

The OpenCode sandbox shares the host network namespace so free-model access and repository-native package/test traffic can work. Do not run this service on a host that exposes ambient cloud credentials to untrusted workloads. In cloud environments, block instance-metadata credential endpoints such as `169.254.169.254` from the service account or host firewall unless they are explicitly required and safely brokered.
