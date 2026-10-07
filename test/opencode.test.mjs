import assert from "node:assert/strict";
import test from "node:test";
import { buildOpenCodeEnvironment } from "../src/opencode.mjs";

test("OpenCode worker environment uses native v2 isolation controls", () => {
  const env = buildOpenCodeEnvironment("/tmp/oc-home");
  assert.equal(env.OPENCODE_CONFIG_PROJECT_DISABLE, "1");
  assert.equal(env.OPENCODE_DISABLE_AUTOUPDATE, "1");
  assert.equal(env.OPENCODE_DB, ":memory:");
  assert.equal(env.OPENCODE_CONFIG_DIR, "/tmp/oc-home/.config/opencode");
  assert.equal(env.HOME, "/tmp/oc-home");

  for (const unsupported of [
    "OPENCODE_DISABLE_PROJECT_CONFIG",
    "OPENCODE_DISABLE_CLAUDE_CODE",
    "OPENCODE_DISABLE_LSP_DOWNLOAD",
    "OPENCODE_DISABLE_EXTERNAL_SKILLS",
    "OPENCODE_CLIENT",
    "DOPPLER_TOKEN",
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(env, unsupported),
      false,
      unsupported + " must not be injected into the v2 worker environment",
    );
  }
});
