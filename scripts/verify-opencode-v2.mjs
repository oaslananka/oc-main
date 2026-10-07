import assert from "node:assert/strict";

let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) input += chunk;

const data = JSON.parse(input);
const target = process.argv[2];

function ruleIndex(rules, action, resource, effect) {
  return rules.findLastIndex(
    (rule) =>
      rule.action === action &&
      rule.resource === resource &&
      rule.effect === effect,
  );
}

function assertGitTransportDenied(agent) {
  const rules = agent.permissions || [];
  for (const resource of [
    "*git*push*",
    "*git*commit*",
    "*git*remote*",
    "*git*config*",
  ]) {
    const deny = ruleIndex(rules, "shell", resource, "deny");
    assert.ok(
      deny >= 0,
      agent.id + " is missing shell deny for " + resource,
    );
    const laterBroadAllow = rules
      .slice(deny + 1)
      .some(
        (rule) =>
          rule.action === "shell" &&
          rule.resource === "*" &&
          rule.effect === "allow",
      );
    assert.equal(
      laterBroadAllow,
      false,
      agent.id +
        " overrides a Git transport deny with a later broad shell allow",
    );
  }
}

if (target === "config") {
  assert.ok(Array.isArray(data));
  const document = data.find(
    (entry) =>
      entry?.type === "document" &&
      entry?.info?.default_agent === "build",
  );
  assert.ok(document, "trusted OpenCode config document was not loaded");

  const info = document.info;
  assert.equal(info.update, "disable");
  assert.equal(info.share, "disabled");
  assert.equal(info.lsp, false);
  assert.deepEqual(info.skills, ["~/.config/opencode/skills"]);
  assert.deepEqual(info.instructions, ["~/.config/opencode/AGENTS.md"]);
  assert.equal(
    Object.keys(info.agents || {}).length,
    0,
    "runtime config must not define custom agents on Console free-tier",
  );

  assert.equal(info.mcp?.servers?.context7?.type, "remote");
  assert.equal(
    info.mcp?.servers?.context7?.url,
    "https://mcp.context7.com/mcp",
  );
  assert.equal(info.mcp?.servers?.context7?.oauth, false);
  assert.equal(info.mcp?.servers?.context7?.disabled, false);
  assert.equal(info.mcp?.servers?.context7?.protocol, "legacy");
  console.log("OpenCode v2 resolved config verified");
} else if (target === "agents") {
  assert.ok(Array.isArray(data));
  const byId = new Map(data.map((agent) => [agent.id, agent]));

  for (const id of ["build", "plan"]) {
    assert.ok(byId.has(id), "missing built-in agent " + id);
    assertGitTransportDenied(byId.get(id));
    assert.ok(
      ruleIndex(byId.get(id).permissions, "subagent", "*", "deny") >= 0,
      id + " must deny custom subagent execution",
    );
  }

  const plan = byId.get("plan");
  assert.ok(
    ruleIndex(plan.permissions, "edit", "*", "deny") >= 0,
    "built-in plan must remain edit-denied",
  );

  for (const id of [
    "orchestrator",
    "planner",
    "researcher",
    "implementer",
    "reviewer",
    "security-reviewer",
    "test-engineer",
    "ci-debugger",
    "release-engineer",
  ]) {
    assert.equal(
      byId.has(id),
      false,
      "custom free-tier-incompatible agent must not be registered: " + id,
    );
  }

  console.log("OpenCode v2 built-in agent policy verified");
} else {
  throw new Error("Expected verification target: config or agents");
}
