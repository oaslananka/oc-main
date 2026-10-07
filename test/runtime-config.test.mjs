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

test("trusted agents use native v2 permissions frontmatter", () => {
  const orchestrator = fs.readFileSync(
    "runtime/opencode/agents/orchestrator.md",
    "utf8",
  );
  const planner = fs.readFileSync(
    "runtime/opencode/agents/planner.md",
    "utf8",
  );
  const researcher = fs.readFileSync(
    "runtime/opencode/agents/researcher.md",
    "utf8",
  );
  const reviewer = fs.readFileSync(
    "runtime/opencode/agents/reviewer.md",
    "utf8",
  );
  const securityReviewer = fs.readFileSync(
    "runtime/opencode/agents/security-reviewer.md",
    "utf8",
  );
  const testEngineer = fs.readFileSync(
    "runtime/opencode/agents/test-engineer.md",
    "utf8",
  );
  const implementer = fs.readFileSync(
    "runtime/opencode/agents/implementer.md",
    "utf8",
  );
  const ciDebugger = fs.readFileSync(
    "runtime/opencode/agents/ci-debugger.md",
    "utf8",
  );
  const releaseEngineer = fs.readFileSync(
    "runtime/opencode/agents/release-engineer.md",
    "utf8",
  );

  for (const agent of [
    orchestrator,
    planner,
    researcher,
    reviewer,
    securityReviewer,
    testEngineer,
    implementer,
    ciDebugger,
    releaseEngineer,
  ]) {
    assert.equal(agent.includes("\npermissions:\n"), true);
    assert.equal(agent.includes("\npermission:\n"), false);
  }

  assert.equal(orchestrator.includes("resource: implementer"), true);
  assert.equal(orchestrator.includes("resource: security-reviewer"), true);

  for (const editingAgent of [implementer, ciDebugger, releaseEngineer]) {
    assert.equal(editingAgent.includes("- action: bash"), false);
    assert.equal(editingAgent.includes("- action: edit"), true);
  }
});
