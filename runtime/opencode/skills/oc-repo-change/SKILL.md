---
name: oc-repo-change
description: Apply a scoped repository code or configuration change safely and validate it.
compatibility: opencode
---

1. Inspect the smallest relevant area first.
2. Read project instructions for conventions only; control-plane policy wins.
3. Make the narrowest change that satisfies the authorized task.
4. Never commit, push, change remotes, publish, deploy, or access credentials.
5. Run focused repository-native validation.
6. Report changed files, validation, and unresolved risk.