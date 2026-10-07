const EDIT_REQUIRED_MODES = new Set([
  "fix",
  "apply",
  "ci",
  "release",
  "refactor",
  "maintenance",
]);

export function requiresTrackedChange(mode, allowEdits) {
  return Boolean(allowEdits) && EDIT_REQUIRED_MODES.has(String(mode || ""));
}

export function isBlockedOutput(output) {
  return /(^|\n)BLOCKED:\s*\S/i.test(String(output || ""));
}
