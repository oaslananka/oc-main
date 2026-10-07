import assert from "node:assert/strict";
import test from "node:test";
import { buildOpenCodeEnvironment } from "../src/opencode.mjs";

test("OpenCode worker environment disables untrusted project configuration", () => {
  const env = buildOpenCodeEnvironment("/tmp/oc-home");
  assert.equal(env.OPENCODE_DISABLE_PROJECT_CONFIG, "1");
  assert.equal(env.OPENCODE_DISABLE_CLAUDE_CODE, "1");
  assert.equal(env.OPENCODE_DISABLE_AUTOUPDATE, "1");
  assert.equal(env.OPENCODE_DISABLE_LSP_DOWNLOAD, "1");
  assert.equal(env.OPENCODE_DISABLE_EXTERNAL_SKILLS, "1");
  assert.equal(env.OPENCODE_DB, ":memory:");
  assert.equal(env.HOME, "/tmp/oc-home");
  assert.equal(Object.prototype.hasOwnProperty.call(env, "DOPPLER_TOKEN"), false);
});
