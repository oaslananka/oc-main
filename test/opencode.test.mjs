import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOpenCodeEnvironment,
  buildRetryPrompt,
  classifyOpenCodeResult,
  cleanOpenCodeOutput,
} from "../src/opencode.mjs";

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

test("extracts assistant text from OpenCode JSONL output", () => {
  const output = [
    JSON.stringify({ type: "step_start", part: { type: "step-start" } }),
    JSON.stringify({ type: "text", part: { type: "text", text: "first" } }),
    JSON.stringify({ type: "text", part: { type: "text", text: "second" } }),
    JSON.stringify({ type: "step_finish", part: { type: "step-finish" } }),
  ].join("\n");

  assert.equal(cleanOpenCodeOutput(output), "first\nsecond");
});

test("keeps plain output when structured JSON is absent", () => {
  assert.equal(cleanOpenCodeOutput("plain result\n"), "plain result");
});

test("retry prompt requires implementation or explicit blocker", () => {
  const prompt = buildRetryPrompt("original", "prior");
  assert.match(prompt, /previous implementation pass completed without any tracked repository change/i);
  assert.match(prompt, /BLOCKED:/);
  assert.match(prompt, /prior/);
});

function jsonl(...events) {
  return events.map((event) => JSON.stringify(event)).join("\n");
}

function recoveredStream({ finishReason } = {}) {
  const messageID = "msg_final";
  const events = [
    { type: "step_start", part: { type: "step-start", messageID: "msg_before" } },
    { type: "error", error: { name: "ProviderError", data: { message: "transient" } } },
    { type: "step_start", part: { type: "step-start", messageID } },
    {
      type: "text",
      part: {
        type: "text",
        messageID,
        text: "Final result",
        time: { start: 1, end: 2 },
      },
    },
  ];
  if (finishReason) {
    events.push({
      type: "step_finish",
      part: { type: "step-finish", messageID, reason: finishReason },
    });
  }
  return jsonl(...events);
}

test("accepts exit zero without recovered-error classification", () => {
  const result = classifyOpenCodeResult({
    stdout: jsonl({
      type: "text",
      part: { type: "text", text: "ok", time: { start: 1, end: 2 } },
    }),
    stderr: "",
    code: 0,
  });
  assert.equal(result.accepted, true);
  assert.equal(result.recovered, false);
  assert.equal(result.output, "ok");
});

test("accepts only a later completed assistant turn after a session error", () => {
  const result = classifyOpenCodeResult({
    stdout: recoveredStream(),
    stderr: "",
    code: 1,
  });
  assert.equal(result.accepted, true);
  assert.equal(result.recovered, true);
  assert.equal(result.reason, "recovered-session-error");
  assert.equal(result.sessionErrorCount, 1);
  assert.equal(result.terminalFinishObserved, false);
  assert.equal(result.output, "Final result");
});

test("accepts a recovered turn with an explicit terminal stop", () => {
  const result = classifyOpenCodeResult({
    stdout: recoveredStream({ finishReason: "stop" }),
    stderr: "",
    code: 1,
  });
  assert.equal(result.accepted, true);
  assert.equal(result.terminalFinishObserved, true);
});

test("rejects unexplained exit one even when final text exists", () => {
  const result = classifyOpenCodeResult({
    stdout: jsonl(
      { type: "step_start", part: { type: "step-start", messageID: "m" } },
      {
        type: "text",
        part: { type: "text", messageID: "m", text: "done", time: { start: 1, end: 2 } },
      },
    ),
    stderr: "",
    code: 1,
  });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "unexplained-exit-one");
});

test("rejects nonzero OpenCode results with stderr", () => {
  const result = classifyOpenCodeResult({
    stdout: recoveredStream(),
    stderr: "runtime failure",
    code: 1,
  });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "nonempty-stderr");
});

test("rejects a recovered stream whose final finish is not terminal", () => {
  const result = classifyOpenCodeResult({
    stdout: recoveredStream({ finishReason: "tool-calls" }),
    stderr: "",
    code: 1,
  });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "nonterminal-final-finish");
});

test("rejects exit one when the error is not followed by completed final text", () => {
  const result = classifyOpenCodeResult({
    stdout: jsonl(
      { type: "step_start", part: { type: "step-start", messageID: "m" } },
      { type: "error", error: { name: "FatalError" } },
    ),
    stderr: "",
    code: 1,
  });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "no-completed-text-after-error");
});

test("rejects malformed JSON streams on nonzero exit", () => {
  const result = classifyOpenCodeResult({
    stdout: recoveredStream() + "\nnot-json",
    stderr: "",
    code: 1,
  });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "invalid-json-stream");
});

test("rejects non-one nonzero exit codes", () => {
  const result = classifyOpenCodeResult({
    stdout: recoveredStream(),
    stderr: "",
    code: 2,
  });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "unexpected-exit-code");
});

