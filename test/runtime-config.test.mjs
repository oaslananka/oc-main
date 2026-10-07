import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtime = path.join(root, "runtime", "opencode");

test("trusted OpenCode v2 config is locked down", () => {
  const config = JSON.parse(fs.readFileSync(path.join(runtime, "opencode.json"), "utf8"));
  assert.equal(config.default_agent, "orchestrator");
  assert.equal(config.share, "disabled");
  assert.equal(config.permission.external_directory, "deny");
  assert.equal(config.permission.skill["*"], "deny");
  assert.equal(config.permission.skill["oc-*"], "allow");
  assert.equal(config.mcp.context7.enabled, false);
});

test("trusted agent pack contains expected roles", () => {
  const names = new Set(fs.readdirSync(path.join(runtime, "agents")).filter((name) => name.endsWith(".md")));
  for (const name of ["orchestrator.md","planner.md","researcher.md","implementer.md","reviewer.md","security-reviewer.md","test-engineer.md","ci-debugger.md","release-engineer.md"]) {
    assert.ok(names.has(name), "missing agent " + name);
  }
});

test("all trusted skills use oc- namespace and valid frontmatter names", () => {
  const dirs = fs.readdirSync(path.join(runtime, "skills"), { withFileTypes: true }).filter((item) => item.isDirectory());
  assert.ok(dirs.length >= 10);
  for (const dir of dirs) {
    assert.match(dir.name, /^oc-[a-z0-9]+(?:-[a-z0-9]+)*$/);
    const skill = fs.readFileSync(path.join(runtime, "skills", dir.name, "SKILL.md"), "utf8");
    assert.match(skill, new RegExp("^---\\nname: " + dir.name + "\\ndescription:", "m"));
  }
});
