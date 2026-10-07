---
name: oc-test-strategy
description: Select high-signal tests and validation for a repository change with bounded runtime.
compatibility: opencode
---

Map changed behavior to the smallest high-signal validation: unit, integration, typecheck, lint, build, package, workflow, or security checks.
Run focused checks first, then broader checks when risk justifies them. Report exact commands and outcomes.