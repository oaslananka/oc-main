import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { runProcess } from "../src/process.mjs";
import {
  quarantineProjectControls,
  restoreProjectControls,
} from "../src/quarantine.mjs";

test("quarantines project agent-control surfaces and restores originals", async () => {
  await fs.rm(".tmp-quarantine-test", { recursive: true, force: true });
  await fs.mkdir(".tmp-quarantine-test/repo/.opencode/skills", { recursive: true });
  await fs.mkdir(".tmp-quarantine-test/repo/src", { recursive: true });
  await fs.mkdir(".tmp-quarantine-test/repo/nested", { recursive: true });
  await fs.writeFile(".tmp-quarantine-test/repo/opencode.json", "{\"permission\":{\"bash\":\"allow\"}}");
  await fs.writeFile(".tmp-quarantine-test/repo/.opencode/skills/evil.md", "malicious");
  await fs.writeFile(".tmp-quarantine-test/repo/AGENTS.md", "override control plane");
  await fs.writeFile(".tmp-quarantine-test/repo/nested/CLAUDE.md", "override");
  await fs.writeFile(".tmp-quarantine-test/repo/src/index.js", "export const ok = true;\n");

  const repositoryDir = path.resolve(".tmp-quarantine-test/repo");
  const quarantineDir = path.resolve(".tmp-quarantine-test/quarantine");
  await runProcess("git", ["init", "-q"], { cwd: repositoryDir });

  const moved = await quarantineProjectControls(repositoryDir, quarantineDir);
  assert.ok(moved.includes("opencode.json"));
  assert.ok(moved.includes(".opencode"));
  assert.ok(moved.includes("AGENTS.md"));
  assert.ok(moved.includes(path.join("nested", "CLAUDE.md")));

  await assert.rejects(fs.access(".tmp-quarantine-test/repo/opencode.json"));
  await assert.rejects(fs.access(".tmp-quarantine-test/repo/.opencode"));
  await assert.rejects(fs.access(".tmp-quarantine-test/repo/AGENTS.md"));
  assert.equal(
    await fs.readFile(".tmp-quarantine-test/repo/src/index.js", "utf8"),
    "export const ok = true;\n",
  );

  await fs.writeFile(".tmp-quarantine-test/repo/opencode.json", "agent-created replacement");
  await restoreProjectControls(repositoryDir, quarantineDir, moved);

  assert.equal(
    await fs.readFile(".tmp-quarantine-test/repo/opencode.json", "utf8"),
    "{\"permission\":{\"bash\":\"allow\"}}",
  );
  assert.equal(
    await fs.readFile(".tmp-quarantine-test/repo/.opencode/skills/evil.md", "utf8"),
    "malicious",
  );
  assert.equal(
    await fs.readFile(".tmp-quarantine-test/repo/AGENTS.md", "utf8"),
    "override control plane",
  );

  await fs.rm(".tmp-quarantine-test", { recursive: true, force: true });
});
