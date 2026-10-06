import assert from "node:assert/strict";
import test from "node:test";
import { parseCommand } from "../src/command.mjs";

const config = {
  defaultModel: "opencode/nemotron-3.5-lightning-free",
  allowedModels: new Set([
    "opencode/nemotron-3.5-lightning-free",
    "opencode/big-pickle",
  ]),
};

test("parses /oc with explicit allowed model", () => {
  assert.deepEqual(
    parseCommand("/oc model=opencode/big-pickle fix test.txt", config),
    {
      model: "opencode/big-pickle",
      prompt: "fix test.txt",
    },
  );
});

test("uses the default model", () => {
  assert.equal(parseCommand("/opencode review this", config).model, config.defaultModel);
});

test("ignores mentions that do not start the trimmed comment", () => {
  assert.equal(parseCommand("please /oc review this", config), null);
});

test("rejects unapproved models", () => {
  assert.throws(
    () => parseCommand("/oc model=other/paid do it", config),
    /Unsupported model/,
  );
});
