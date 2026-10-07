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

test("trusted OpenCode v2 config uses free-tier compatible built-in agents", () => {
  const config = loadConfig();

  assert.equal(config.default_agent, "build");
  assert.equal(config.share, "disabled");
  assert.equal(config.update, "disable");
  assert.equal(config.lsp, false);
  assert.deepEqual(config.skills, ["~/.config/opencode/skills"]);
  assert.deepEqual(config.instructions, ["~/.config/opencode/AGENTS.md"]);
  assert.equal(Object.prototype.hasOwnProperty.call(config, "agents"), false);

  assert.equal(
    hasRule(config.permissions, "external_directory", "*", "deny"),
    true,
  );
  assert.equal(hasRule(config.permissions, "question", "*", "deny"), true);
  assert.equal(hasRule(config.permissions, "skill", "*", "deny"), true);
  assert.equal(hasRule(config.permissions, "skill", "oc-*", "allow"), true);
  assert.equal(hasRule(config.permissions, "shell", "*", "allow"), true);
  assert.equal(
    hasRule(config.permissions, "shell", "*git*push*", "deny"),
    true,
  );
  assert.equal(
    hasRule(config.permissions, "shell", "*git*commit*", "deny"),
    true,
  );
  assert.equal(
    hasRule(config.permissions, "shell", "*git*remote*", "deny"),
    true,
  );
  assert.equal(
    hasRule(config.permissions, "shell", "*git*config*", "deny"),
    true,
  );
  assert.equal(
    hasRule(config.permissions, "subagent", "*", "deny"),
    true,
  );

  assert.equal(config.mcp.servers.context7.type, "remote");
  assert.equal(
    config.mcp.servers.context7.url,
    "https://mcp.context7.com/mcp",
  );
  assert.equal(config.mcp.servers.context7.oauth, false);
  assert.equal(config.mcp.servers.context7.disabled, false);
  assert.equal(config.mcp.servers.context7.protocol, "legacy");
});

test("trusted skill pack uses only the oc- namespace", () => {
  assert.equal(
    fs.existsSync("runtime/opencode/skills/oc-repo-change/SKILL.md"),
    true,
  );
  assert.equal(
    fs.existsSync("runtime/opencode/skills/oc-planning/SKILL.md"),
    true,
  );
  assert.equal(
    fs.existsSync("runtime/opencode/skills/oc-research/SKILL.md"),
    true,
  );
  assert.equal(
    fs.existsSync("runtime/opencode/skills/oc-review/SKILL.md"),
    true,
  );
  assert.equal(
    fs.existsSync("runtime/opencode/skills/oc-security-review/SKILL.md"),
    true,
  );
  assert.equal(
    fs.existsSync("runtime/opencode/skills/oc-ci-debug/SKILL.md"),
    true,
  );
  assert.equal(
    fs.existsSync("runtime/opencode/skills/oc-test-strategy/SKILL.md"),
    true,
  );
  assert.equal(
    fs.existsSync("runtime/opencode/skills/oc-release/SKILL.md"),
    true,
  );
  assert.equal(
    fs.existsSync("runtime/opencode/skills/oc-dependency-upgrade/SKILL.md"),
    true,
  );
  assert.equal(
    fs.existsSync("runtime/opencode/skills/oc-refactor/SKILL.md"),
    true,
  );
  assert.equal(
    fs.existsSync("runtime/opencode/skills/oc-docs/SKILL.md"),
    true,
  );
});
