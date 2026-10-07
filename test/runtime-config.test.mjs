import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("trusted OpenCode v2 config is locked down", () => {
  const config = JSON.parse(
    fs.readFileSync("runtime/opencode/opencode.json", "utf8"),
  );
  assert.equal(config.default_agent, "orchestrator");
  assert.equal(config.share, "disabled");
  assert.equal(config.permission.external_directory, "deny");
  assert.equal(config.permission.skill["*"], "deny");
  assert.equal(config.permission.skill["oc-*"], "allow");
  assert.equal(config.mcp.context7.enabled, true);
});

test("trusted agent pack contains expected roles", () => {
  assert.equal(fs.existsSync("runtime/opencode/agents/orchestrator.md"), true);
  assert.equal(fs.existsSync("runtime/opencode/agents/planner.md"), true);
  assert.equal(fs.existsSync("runtime/opencode/agents/researcher.md"), true);
  assert.equal(fs.existsSync("runtime/opencode/agents/implementer.md"), true);
  assert.equal(fs.existsSync("runtime/opencode/agents/reviewer.md"), true);
  assert.equal(fs.existsSync("runtime/opencode/agents/security-reviewer.md"), true);
  assert.equal(fs.existsSync("runtime/opencode/agents/test-engineer.md"), true);
  assert.equal(fs.existsSync("runtime/opencode/agents/ci-debugger.md"), true);
  assert.equal(fs.existsSync("runtime/opencode/agents/release-engineer.md"), true);
});

test("trusted skill pack uses only the oc- namespace", () => {
  assert.equal(fs.existsSync("runtime/opencode/skills/oc-repo-change/SKILL.md"), true);
  assert.equal(fs.existsSync("runtime/opencode/skills/oc-planning/SKILL.md"), true);
  assert.equal(fs.existsSync("runtime/opencode/skills/oc-research/SKILL.md"), true);
  assert.equal(fs.existsSync("runtime/opencode/skills/oc-review/SKILL.md"), true);
  assert.equal(fs.existsSync("runtime/opencode/skills/oc-security-review/SKILL.md"), true);
  assert.equal(fs.existsSync("runtime/opencode/skills/oc-ci-debug/SKILL.md"), true);
  assert.equal(fs.existsSync("runtime/opencode/skills/oc-test-strategy/SKILL.md"), true);
  assert.equal(fs.existsSync("runtime/opencode/skills/oc-release/SKILL.md"), true);
  assert.equal(fs.existsSync("runtime/opencode/skills/oc-dependency-upgrade/SKILL.md"), true);
  assert.equal(fs.existsSync("runtime/opencode/skills/oc-refactor/SKILL.md"), true);
  assert.equal(fs.existsSync("runtime/opencode/skills/oc-docs/SKILL.md"), true);
});
