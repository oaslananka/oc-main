---
name: oc-refactor
description: Refactor implementation while preserving behavior and proving equivalence with focused validation.
compatibility: opencode
---

State the behavior that must remain unchanged. Keep the refactor bounded and avoid unrelated cleanup.
Prefer mechanical transformations with tests or type/lint/build evidence. Report any behavior-affecting ambiguity.