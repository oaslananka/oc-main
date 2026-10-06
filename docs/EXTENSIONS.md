# OpenCode extensions

The central runner is intentionally prepared for shared OpenCode capabilities without adding files to target repositories.

## Global instructions and skills

Everything under `runtime/opencode/` is copied into the isolated job home before OpenCode starts. The worker therefore sees the central runtime policy and global skills through its normal `~/.config/opencode/` discovery paths.

Add shared skills under:

```text
runtime/opencode/skills/<skill-name>/SKILL.md
```

Target-repository `AGENTS.md` files still apply and should remain the source of repository-specific commands and invariants.

## MCP servers

OpenCode supports local and remote MCP servers through its normal configuration. When MCP integration is added here, keep the configuration under the central runtime configuration rather than modifying every target repository.

Secrets for an MCP server must not be committed. Add only the specific credential required by that MCP integration to the isolated worker environment. Do not expose the GitHub App private key, webhook secret, installation token, Doppler token, or Docker socket to OpenCode.

Remote MCP endpoints should be allowlisted intentionally. Local MCP processes run inside the same short-lived worker container as OpenCode and should be treated as part of the trusted worker image.

## Plugins and tools

Prefer OpenCode-native skills, MCP servers, and repository-native tools. A ChatGPT plugin is not automatically an OpenCode plugin; equivalent functionality must be exposed through an API, MCP server, command-line tool, or another OpenCode-supported integration.

Additional CLI tools that should be available to every OpenCode job belong in the Docker image. Keep the image intentionally small and pin downloaded standalone binaries with checksums.

## Security rule

Extensions must not weaken the central trust boundary:

- the GitHub comment author is checked by numeric user ID;
- webhook signatures are mandatory;
- unrelated GitHub App webhook events are ignored by the controller;
- GitHub and Doppler credentials remain controller-only;
- the Docker socket remains controller-only;
- the target checkout's `.git` directory is mounted read-only inside the worker;
- the controller, not OpenCode, creates commits and pushes changes.
