import assert from "node:assert/strict";
import test from "node:test";
import { parseCommand } from "../src/command.mjs";

const config = {
  defaultModel: "opencode/nemotron-3.5-lightning-free",
  allowedModels: new Set([
    "opencode/nemotron-3.5-lightning-free",
    "opencode/nemotron-3-ultra-free",
    "opencode/mimo-v2.6-flash-free",
    "opencode/big-pickle",
  ]),
};

test("parses /oc mode with explicit allowed model", () => {
  assert.deepEqual(parseCommand("/oc fix model=opencode/big-pickle fix test.txt", config), {
    mode: "fix", model: "opencode/big-pickle", prompt: "fix test.txt",
  });
});

test("routes plan mode to preferred allowed model", () => {
  const parsed = parseCommand("/oc plan migrate the workflow", config);
  assert.equal(parsed.mode, "plan");
  assert.equal(parsed.model, "opencode/nemotron-3-ultra-free");
});

test("routes research mode to fast preferred model", () => {
  const parsed = parseCommand("/opencode research current npm OIDC docs", config);
  assert.equal(parsed.mode, "research");
  assert.equal(parsed.model, "opencode/mimo-v2.6-flash-free");
});

test("model=auto uses mode router", () => {
  assert.equal(parseCommand("/oc security model=auto audit auth", config).model, "opencode/nemotron-3-ultra-free");
});

test("keeps backwards compatible /oc prompt in auto mode", () => {
  const parsed = parseCommand("/oc update test.txt", config);
  assert.equal(parsed.mode, "auto");
  assert.equal(parsed.prompt, "update test.txt");
});

test("ignores mentions that do not start the trimmed comment", () => {
  assert.equal(parseCommand("please /oc review this", config), null);
});

test("rejects unapproved models", () => {
  assert.throws(() => parseCommand("/oc model=other/paid do it", config), /Unsupported model/);
});
