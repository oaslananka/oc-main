---
name: oc-release
description: Safely modify release, packaging, OIDC, provenance, attestation, and publishing configuration.
compatibility: opencode
---

Preserve explicit approval boundaries, provenance, attestations, release quality gates, version consistency, and least-privilege OIDC permissions.
Never actually publish, tag, create a release, deploy, or use long-lived write tokens from the agent runtime.
Treat real release/publish execution as a trusted external step after repository review.