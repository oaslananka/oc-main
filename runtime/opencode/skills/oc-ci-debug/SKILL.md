---
name: oc-ci-debug
description: Diagnose CI, workflow, build, lint, typecheck, and test failures without weakening gates.
compatibility: opencode
---

Reproduce the smallest failing command when practical. Trace the first causal failure rather than downstream noise.
Fix root cause with the narrowest change. Never skip, disable, or relax a required gate solely to make CI green.
Validate YAML/workflow syntax and relevant repository-native checks.