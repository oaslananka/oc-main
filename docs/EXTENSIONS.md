# OpenCode extensions

Shared OpenCode capabilities live in the control repository and are applied by GitHub-hosted workers. Target repositories do not need oc-main-specific files.

## Global instructions and skills

Everything under `runtime/opencode/` is copied into the GitHub Actions job's isolated OpenCode home before a run.

Add shared skills under:

```text
runtime/opencode/skills/<skill-name>/SKILL.md
```

Target-repository `AGENTS.md` remains the authority for repository-specific commands and invariants.

## MCP servers

OpenCode supports local and remote MCP servers through its normal configuration. Central MCP configuration should live under `runtime/opencode/`.

MCP credentials must be scoped separately and intentionally. Do not expose the GitHub App private key, webhook secret, Doppler bootstrap token, or installation tokens to OpenCode.

If an MCP needs a secret, add only that specific credential to the OpenCode execution environment after reviewing the trust implications.

## Plugins and tools

Prefer OpenCode-native skills, MCP servers, and repository-native tools. ChatGPT plugins are not automatically OpenCode plugins; equivalent functionality must be exposed through an OpenCode-supported API, MCP server, CLI, or tool integration.

## Security rule

Extensions must preserve these boundaries:

- only allowlisted numeric GitHub user IDs trigger work;
- webhook HMAC verification happens on the VPS;
- controller-to-worker jobs are signed and short-lived;
- GitHub and Doppler credentials are used only by prepare/finalize steps;
- the OpenCode execution step has no GitHub App or Doppler credentials;
- target PR head state is checked again before push;
- the worker never force-pushes.
