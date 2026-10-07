import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function hasRule(config, action, resource, effect) {
  return config.permissions.some(
    (rule) =>
      rule.action === action &&
      rule.resource === resource &&
      rule.effect === effect,
  );
}

test("trusted OpenCode v2 config is native and locked down", () => {
  const config = JSON.parse(
    fs.readFileSync("runtime/opencode/opencode.json", "utf8"),
  );

  assert.equal(config.default_agent, "orchestrator");
  assert.equal(config.share, "disabled");
  assert.equal(config.update, "disable");

  assert.equal(hasRule(config, "external_directory", "*", "deny"), true);
  assert.equal(hasRule(config, "question", "*", "deny"), true);
  assert.equal(hasRule(config, "skill", "*", "deny"), true);
  assert.equal(hasRule(config, "skill", "oc-*", "allow"), true);
  assert.equal(hasRule(config, "task", "*", "deny"), true);
  assert.equal(hasRule(config, "bash", "*git push*", "deny"), true);
  assert.equal(hasRule(config, "bash", "*git commit*", "deny"), true);

  assert.equal(config.agents.build.disabled, true);
  assert.equal(config.agents.plan.disabled, true);

  assert.equal(config.mcp.servers.context7.type, "remote");
  assert.equal(config.mcp.servers.context7.url, "https://mcp.context7.com/mcp");
  assert.equal(config.mcp.servers.context7.oauth, false);
  assert.equal(config.mcp.servers.context7.disabled, false);
  assert.equal(config.mcp.servers.context7.protocol, "legacy");
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
