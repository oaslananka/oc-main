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
    "*git push*",
    "*git commit*",
    "*git remote*",
  ]) {
    const deny = ruleIndex(rules, "bash", resource, "deny");
    assert.ok(deny >= 0, agent.id + " is missing bash deny for " + resource);
    const laterBroadAllow = rules
      .slice(deny + 1)
      .some(
        (rule) =>
          rule.action === "bash" &&
          rule.resource === "*" &&
          rule.effect === "allow",
      );
    assert.equal(
      laterBroadAllow,
      false,
      agent.id + " overrides a Git transport deny with a later broad allow",
    );
  }
}

if (target === "config") {
  assert.ok(Array.isArray(data));
  const document = data.find(
    (entry) =>
      entry?.type === "document" &&
      entry?.info?.default_agent === "orchestrator",
  );
  assert.ok(document, "trusted OpenCode config document was not loaded");
  const info = document.info;
  assert.equal(info.update, "disable");
  assert.equal(info.share, "disabled");
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
    assert.ok(byId.has(id), "missing trusted agent " + id);
  }

  for (const id of [
    "implementer",
    "ci-debugger",
    "release-engineer",
    "test-engineer",
  ]) {
    assertGitTransportDenied(byId.get(id));
  }

  const orchestrator = byId.get("orchestrator");
  assert.equal(
    ruleIndex(orchestrator.permissions, "bash", "*", "deny") >= 0,
    true,
  );
  assert.equal(
    ruleIndex(orchestrator.permissions, "edit", "*", "deny") >= 0,
    true,
  );
  assert.equal(
    ruleIndex(orchestrator.permissions, "task", "implementer", "allow") >= 0,
    true,
  );
  assert.equal(
    ruleIndex(
      orchestrator.permissions,
      "task",
      "security-reviewer",
      "allow",
    ) >= 0,
    true,
  );

  for (const id of [
    "planner",
    "researcher",
    "reviewer",
    "security-reviewer",
  ]) {
    const agent = byId.get(id);
    assert.equal(ruleIndex(agent.permissions, "edit", "*", "deny") >= 0, true);
    assert.equal(ruleIndex(agent.permissions, "bash", "*", "deny") >= 0, true);
  }

  console.log("OpenCode v2 resolved agent permissions verified");
} else {
  throw new Error("Expected verification target: config or agents");
}
