# OpenCode extensions

The central runner is intentionally prepared for shared OpenCode capabilities without adding files to target repositories.

## Global instructions and skills

Everything under `runtime/opencode/` is copied into the isolated job home before OpenCode starts. OpenCode therefore sees the central runtime policy and global skills through its normal `~/.config/opencode/` discovery paths.

Add shared skills under:

```text
runtime/opencode/skills/<skill-name>/SKILL.md
```

Target-repository `AGENTS.md` files still apply and should remain the source of repository-specific commands and invariants.

## MCP servers

OpenCode supports local and remote MCP servers through its normal configuration. When MCP integration is added here, keep the configuration under the central runtime configuration rather than modifying every target repository.

Secrets for an MCP server must not be committed. Add only the specific credential required by that MCP integration to the isolated OpenCode environment. Do not expose the GitHub App private key, webhook secret, or installation token to OpenCode.

Remote MCP endpoints should be allowlisted intentionally. Local MCP processes run inside the same sandbox boundary as OpenCode and should be treated as part of the trusted runtime image.

## Plugins and tools

Prefer OpenCode-native skills, MCP servers, and repository-native tools. A ChatGPT plugin is not automatically an OpenCode plugin; equivalent functionality must be exposed through an API, MCP server, command-line tool, or another OpenCode-supported integration.

## Security rule

Extensions must not weaken the central trust boundary:

- the GitHub comment author is still checked by numeric user ID;
- webhook signatures are still mandatory;
- GitHub credentials remain controller-only;
- the target checkout's `.git` directory is mounted read-only inside the OpenCode sandbox;
- the controller, not OpenCode, creates commits and pushes changes.
