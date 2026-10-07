import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function hasRule(rules, action, resource, effect) {
  return rules.some(
    (rule) =>
      rule.action === action &&
      rule.resource === resource &&
      rule.effect === effect,
  );
}

function loadConfig() {
  return JSON.parse(
    fs.readFileSync("runtime/opencode/opencode.json", "utf8"),
  );
}

test("trusted OpenCode v2 config is native and locked down", () => {
  const config = loadConfig();

  assert.equal(config.default_agent, "orchestrator");
  assert.equal(config.share, "disabled");
  assert.equal(config.update, "disable");
  assert.equal(config.lsp, false);
  assert.deepEqual(config.skills, ["~/.config/opencode/skills"]);

  assert.equal(hasRule(config.permissions, "external_directory", "*", "deny"), true);
  assert.equal(hasRule(config.permissions, "question", "*", "deny"), true);
  assert.equal(hasRule(config.permissions, "skill", "*", "deny"), true);
  assert.equal(hasRule(config.permissions, "skill", "oc-*", "allow"), true);
  assert.equal(hasRule(config.permissions, "task", "*", "deny"), true);
  assert.equal(hasRule(config.permissions, "bash", "*git push*", "deny"), true);
  assert.equal(hasRule(config.permissions, "bash", "*git commit*", "deny"), true);
  assert.equal(hasRule(config.permissions, "bash", "*git remote*", "deny"), true);

  assert.equal(config.agents.build.disabled, true);
  assert.equal(config.agents.plan.disabled, true);

  assert.equal(config.mcp.servers.context7.type, "remote");
  assert.equal(config.mcp.servers.context7.url, "https://mcp.context7.com/mcp");
  assert.equal(config.mcp.servers.context7.oauth, false);
  assert.equal(config.mcp.servers.context7.disabled, false);
  assert.equal(config.mcp.servers.context7.protocol, "legacy");
});

test("trusted agent pack is defined directly in native v2 config", () => {
  const config = loadConfig();
  const ids = [
    "orchestrator",
    "planner",
    "researcher",
    "implementer",
    "reviewer",
    "security-reviewer",
    "test-engineer",
    "ci-debugger",
    "release-engineer",
  ];

  for (const id of ids) {
    assert.ok(config.agents[id], "missing trusted config agent " + id);
    assert.equal(typeof config.agents[id].system, "string");
    assert.ok(config.agents[id].system.length > 20);
    assert.ok(Array.isArray(config.agents[id].permissions));
  }

  assert.equal(config.agents.orchestrator.mode, "primary");
  assert.equal(config.agents.implementer.mode, "subagent");
  assert.equal(config.agents.implementer.hidden, true);
  assert.equal(config.agents["ci-debugger"].hidden, true);
  assert.equal(config.agents["release-engineer"].hidden, true);

  assert.equal(
    hasRule(config.agents.orchestrator.permissions, "edit", "*", "deny"),
    true,
  );
  assert.equal(
    hasRule(config.agents.orchestrator.permissions, "bash", "*", "deny"),
    true,
  );
  assert.equal(
    hasRule(config.agents.orchestrator.permissions, "task", "implementer", "allow"),
    true,
  );
  assert.equal(
    hasRule(
      config.agents.orchestrator.permissions,
      "task",
      "security-reviewer",
      "allow",
    ),
    true,
  );

  for (const id of ["planner", "researcher", "reviewer", "security-reviewer"]) {
    assert.equal(hasRule(config.agents[id].permissions, "edit", "*", "deny"), true);
    assert.equal(hasRule(config.agents[id].permissions, "bash", "*", "deny"), true);
  }

  for (const id of ["implementer", "ci-debugger", "release-engineer"]) {
    assert.equal(hasRule(config.agents[id].permissions, "edit", "*", "allow"), true);
    assert.equal(
      config.agents[id].permissions.some((rule) => rule.action === "bash"),
      false,
      id + " must inherit the global bash deny rules without overriding them",
    );
  }
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
