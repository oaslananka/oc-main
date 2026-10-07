---
name: oc-security-review
description: Threat-review code, workflows, dependencies, auth, secrets, supply chain, and prompt-injection boundaries.
compatibility: opencode
---

Check trust boundaries, credential exposure, command/path injection, SSRF/network access, auth/OIDC, GitHub Actions permissions, artifact provenance, dependency risk, prompt injection, and release/deploy controls.
Prefer exploitability and impact over theoretical style issues. Do not weaken security to make checks pass.