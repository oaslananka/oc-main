# Agent instructions

This repository is the central control plane for an owner-operated GitHub coding bot.

## Canonical commands

- `npm test` — run unit tests.
- `npm run check` — syntax-check source and tests.
- `npm start` — start the webhook controller when the required runtime environment is present.
- `docker compose -f compose.yml config` — validate the VPS webhook deployment.
- `scripts/verify-doppler.sh` — validate Doppler `oc-main/main` without printing secret values.

## Architecture

- The Ubuntu VPS runs only the lightweight webhook controller and Caddy in Docker.
- The VPS does not run OpenCode workers.
- Accepted owner commands are signed and sent to this repository with GitHub `repository_dispatch`.
- `.github/workflows/opencode-worker.yml` runs the real OpenCode CLI on a GitHub-hosted Ubuntu runner. Do not replace it with the OpenCode GitHub Action.
- GitHub App authentication and API calls live in `src/github.mjs`.
- Comment parsing and authorization live in `src/command.mjs` and `src/webhook.mjs`.
- Target repositories are cloned and changed on the GitHub-hosted worker through `src/action-*.mjs` and `src/git.mjs`.
- Runtime-wide OpenCode instructions and skills live under `runtime/opencode/`.
- Doppler project `oc-main`, config `main`, is the source of truth for runtime settings and secrets. Outside Doppler, only `DOPPLER_TOKEN` is permitted as a bootstrap credential.

## Security invariants

- Verify the GitHub webhook HMAC before acting on a delivery.
- Only explicitly allowlisted numeric GitHub user IDs may trigger work.
- Unhandled GitHub App webhook event types must be acknowledged and ignored; the App may have unrelated subscriptions and permissions.
- Sign controller-to-worker dispatch payloads and reject expired or invalid worker payloads.
- Never log or commit GitHub App private keys, webhook secrets, installation tokens, Doppler tokens, auth headers, or other credentials.
- The OpenCode execution step must not receive `DOPPLER_TOKEN`, GitHub App credentials, installation tokens, or a persisted checkout credential.
- Use array-based process spawning; do not interpolate webhook text into shell commands.
- Before pushing, require the PR head SHA to still match the snapshot prepared for the run.
- Never force-push.
- Do not add GitHub repository secrets other than `DOPPLER_TOKEN`.

## Change discipline

Keep control-plane changes small and testable. Update `docs/OPERATIONS.md` when deployment, required permissions, environment variables, Doppler configuration, webhook routing, or worker behavior changes.
