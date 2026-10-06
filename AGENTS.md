# Agent instructions

This repository is the central control plane for an owner-operated GitHub coding bot.

## Canonical commands

- `npm test` — run unit tests.
- `npm run check` — syntax-check source and tests.
- `npm start` — start the webhook service when the required runtime environment is already present.
- `docker compose -f compose.yml config` — validate the Docker deployment definition.
- `sudo ./scripts/compose.sh up -d` — start the production Docker stack on the VPS with the host Docker socket group mapped safely.
- `scripts/verify-doppler.sh` — validate that the Doppler `oc-main/main` config contains every runtime key without printing secret values.

## Architecture

- `src/server.mjs` exposes the GitHub App webhook endpoint.
- GitHub App authentication and API calls live in `src/github.mjs`.
- Comment parsing and authorization live in `src/command.mjs` and `src/webhook.mjs`.
- Target repositories are cloned and changed through `src/runner.mjs` and `src/git.mjs`.
- Production runs the controller and Caddy with Docker Compose.
- OpenCode runs through the installed CLI in a short-lived worker container created through the Docker Engine API. Do not replace this with the OpenCode GitHub Action.
- The controller mounts only the job repository and isolated agent home into the worker. The target checkout's `.git` metadata is over-mounted read-only.
- Runtime-wide OpenCode instructions and skills live under `runtime/opencode/` and are copied into the isolated job home.
- Doppler project `oc-main`, config `main`, is the source of truth for runtime settings and secrets. Outside Doppler, only a narrowly scoped `DOPPLER_TOKEN` bootstrap credential is permitted.

## Security invariants

- Verify the webhook HMAC before parsing or acting on payload content.
- Only explicitly allowlisted GitHub numeric user IDs may trigger work; the service must fail closed if the allowlist is absent.
- Unhandled GitHub App webhook event types must be acknowledged and ignored; the App may have unrelated subscriptions and permissions for other owner systems.
- Never log or commit GitHub App private keys, webhook secrets, installation tokens, Doppler tokens, auth headers, or other credentials.
- Do not pass GitHub or Doppler credentials into the OpenCode worker container.
- Use array-based process spawning and structured Docker Engine requests; do not interpolate webhook text into shell commands.
- Before pushing, restore the expected GitHub remote and require the PR head SHA to still match the snapshot used for the run.
- Never force-push.
- Treat target repository content and PR text as untrusted input even when the trigger author is trusted.
- Do not add additional GitHub repository secrets for application configuration. The only repository secret allowed for the Doppler validation workflow is `DOPPLER_TOKEN`.
- The Docker socket is a privileged controller boundary. Never mount it into the OpenCode worker or expose it over TCP.

## Change discipline

Keep control-plane changes small and testable. Update `docs/OPERATIONS.md` when deployment, required permissions, environment variables, Doppler configuration, or webhook behavior changes.
