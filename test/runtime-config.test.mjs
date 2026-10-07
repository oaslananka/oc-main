import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function loadConfig() {
  return JSON.parse(
    fs.readFileSync("runtime/opencode/opencode.json", "utf8"),
  );
}

function permissionKeys(config) {
  return new Set(
    config.permissions.map(
      ({ action, resource, effect }) =>
        action + "\0" + resource + "\0" + effect,
    ),
  );
}

test("trusted OpenCode v2 config uses free-tier compatible built-ins", () => {
  const config = loadConfig();

  assert.deepEqual(
    {
      defaultAgent: config.default_agent,
      share: config.share,
      update: config.update,
      lsp: config.lsp,
      skills: config.skills,
      instructions: config.instructions,
      hasCustomAgents: Object.prototype.hasOwnProperty.call(config, "agents"),
    },
    {
      defaultAgent: "build",
      share: "disabled",
      update: "disable",
      lsp: false,
      skills: ["~/.config/opencode/skills"],
      instructions: ["~/.config/opencode/AGENTS.md"],
      hasCustomAgents: false,
    },
  );

  const actualRules = permissionKeys(config);
  const requiredRules = [
    ["external_directory", "*", "deny"],
    ["question", "*", "deny"],
    ["skill", "*", "deny"],
    ["skill", "oc-*", "allow"],
    ["shell", "*", "allow"],
    ["shell", "*git*push*", "deny"],
    ["shell", "*git*commit*", "deny"],
    ["shell", "*git*remote*", "deny"],
    ["shell", "*git*config*", "deny"],
    ["subagent", "*", "deny"],
  ];
  for (const rule of requiredRules) {
    assert.equal(
      actualRules.has(rule.join("\0")),
      true,
      "missing trusted permission rule: " + rule.join(" "),
    );
  }

  assert.deepEqual(config.mcp.servers.context7, {
    type: "remote",
    url: "https://mcp.context7.com/mcp",
    oauth: false,
    disabled: false,
    protocol: "legacy",
  });
});

test("trusted skill directory contains exactly the oc-main skill pack", () => {
  const names = fs
    .readdirSync("runtime/opencode/skills", { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  assert.deepEqual(names, [
    "oc-ci-debug",
    "oc-dependency-upgrade",
    "oc-docs",
    "oc-planning",
    "oc-refactor",
    "oc-release",
    "oc-repo-change",
    "oc-research",
    "oc-review",
    "oc-security-review",
    "oc-test-strategy",
  ]);
});
