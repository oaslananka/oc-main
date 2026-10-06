# Operations

## Runtime model

`oc-main` is a central GitHub App webhook service. Target repositories do not need an `oc-main` workflow or integration file. The GitHub App must be installed on every repository the service is allowed to operate on.

OpenCode is installed as a CLI on the Ubuntu host. The service does not use the OpenCode GitHub Action and does not require an OpenCode provider API key for the configured free Zen models.

Each accepted PR command is processed as follows:

1. Verify the GitHub webhook HMAC.
2. Require the comment author's numeric GitHub user ID to be allowlisted.
3. Mint a short-lived GitHub App installation token.
4. Read the PR head repository, branch, and exact head SHA.
5. Clone that branch into a temporary job directory.
6. Run `opencode run --model ...` in a bubblewrap sandbox with no GitHub credentials in the OpenCode environment.
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

`ALLOWED_GITHUB_USER_IDS` is a comma-separated list of numeric GitHub user IDs. The default configuration is scoped to the repository owner's current numeric ID. Usernames are not used as the security boundary.

A command must begin the trimmed comment:

```text
/oc fix the failing test
```

An allowed model can be selected per comment:

```text
/oc model=opencode/big-pickle fix the failing test
```

Comments from any other GitHub user are acknowledged and ignored.

## Required environment

Copy `.env.example` to a protected host-side environment file. Never commit the populated file.

Required values:

- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY_BASE64`
- `GITHUB_WEBHOOK_SECRET`

For the private key, base64-encode the PEM as a single line before putting it in the environment file. The raw private key must not be committed.

The model allowlist is controlled by `ALLOWED_MODELS`. `DEFAULT_MODEL` must be one of those values.

## Ubuntu host bootstrap

Run `scripts/bootstrap-ubuntu.sh` on the Ubuntu host. It installs the OS packages required by the service and installs a pinned OpenCode CLI release after verifying its SHA-256 digest.

Create a dedicated service user and directories:

```bash
sudo useradd --system --home /nonexistent --shell /usr/sbin/nologin ocmain || true
sudo install -d -o ocmain -g ocmain -m 0700 /var/lib/oc-main /var/lib/oc-main/jobs
sudo install -d -o root -g root -m 0755 /opt/oc-main
sudo install -m 0600 /path/to/oc-main.env /etc/oc-main.env
```

Deploy the repository contents to `/opt/oc-main`, then install and start the unit:

```bash
sudo cp deploy/oc-main.service /etc/systemd/system/oc-main.service
sudo systemctl daemon-reload
sudo systemctl enable --now oc-main
sudo systemctl status oc-main
```

Expose the service to GitHub over HTTPS using the reverse proxy or ingress already used by the host. Do not expose the webhook endpoint without TLS.

## Sandbox boundary

Production should keep `SANDBOX_MODE=bwrap`. `SANDBOX_MODE=none` exists only for local debugging and should not be used for webhook-driven production work.

The OpenCode process receives a minimal environment without GitHub App secrets or installation tokens. The sandbox mounts the target checkout read/write and mounts system binaries and certificates read-only. Git transport remains controller-owned.

## Current limitation

The in-memory queue and webhook delivery de-duplication state do not survive a service restart. This is acceptable for the first deployment, but a durable queue should be added before relying on the service for high-volume or long-running automation.

## Host egress

The OpenCode sandbox shares the host network namespace so free-model access and repository-native package/test traffic can work. Do not run this service on a host that exposes ambient cloud credentials to untrusted workloads. In cloud environments, block instance-metadata credential endpoints such as `169.254.169.254` from the service account or host firewall unless they are explicitly required and safely brokered.
