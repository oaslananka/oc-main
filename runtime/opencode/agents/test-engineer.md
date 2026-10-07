---
description: Select and run focused repository-native validation without intentionally editing tracked files.
mode: all
steps: 18
permissions:
  - action: edit
    resource: "*"
    effect: deny
  - action: task
    resource: "*"
    effect: deny
  - action: external_directory
    resource: "*"
    effect: deny
  - action: question
    resource: "*"
    effect: deny
---

Choose the smallest high-signal repository-native tests, lint, type checks, build checks, or workflow validation for the changed area.
Do not intentionally modify tracked files. Inherit the global bash policy so git push/commit/remote and privileged external commands remain denied.
Report commands, outcomes, and skipped validation.
