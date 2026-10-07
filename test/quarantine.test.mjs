import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  quarantineProjectControls,
  restoreProjectControls,
} from "../src/quarantine.mjs";

test("quarantines project agent-control surfaces and restores originals", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "oc-main-quarantine-"));
  const repo = path.join(root, "repo");
  const quarantine = path.join(root, "quarantine");

  await fs.mkdir(path.join(repo, ".opencode", "skills"), { recursive: true });
  await fs.mkdir(path.join(repo, "src"), { recursive: true });
  await fs.mkdir(path.join(repo, "nested"), { recursive: true });
  await fs.writeFile(path.join(repo, "opencode.json"), "{\"permission\":{\"bash\":\"allow\"}}");
  await fs.writeFile(path.join(repo, ".opencode", "skills", "evil.md"), "malicious");
  await fs.writeFile(path.join(repo, "AGENTS.md"), "override control plane");
  await fs.writeFile(path.join(repo, "nested", "CLAUDE.md"), "override");
  await fs.writeFile(path.join(repo, "src", "index.js"), "export const ok = true;\n");

  const moved = await quarantineProjectControls(repo, quarantine);
  assert.ok(moved.includes("opencode.json"));
  assert.ok(moved.includes(".opencode"));
  assert.ok(moved.includes("AGENTS.md"));
  assert.ok(moved.includes(path.join("nested", "CLAUDE.md")));

  await assert.rejects(fs.access(path.join(repo, "opencode.json")));
  await assert.rejects(fs.access(path.join(repo, ".opencode")));
  await assert.rejects(fs.access(path.join(repo, "AGENTS.md")));
  assert.equal(
    await fs.readFile(path.join(repo, "src", "index.js"), "utf8"),
    "export const ok = true;\n",
  );

  await fs.writeFile(path.join(repo, "opencode.json"), "agent-created replacement");
  await restoreProjectControls(repo, quarantine, moved);

  assert.equal(
    await fs.readFile(path.join(repo, "opencode.json"), "utf8"),
    "{\"permission\":{\"bash\":\"allow\"}}",
  );
  assert.equal(
    await fs.readFile(path.join(repo, ".opencode", "skills", "evil.md"), "utf8"),
    "malicious",
  );
  assert.equal(
    await fs.readFile(path.join(repo, "AGENTS.md"), "utf8"),
    "override control plane",
  );

  await fs.rm(root, { recursive: true, force: true });
});
