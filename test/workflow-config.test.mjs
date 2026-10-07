import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(
  ".github/workflows/opencode-worker.yml",
  "utf8",
);

function indexOfStep(name) {
  const index = workflow.indexOf("- name: " + name);
  assert.notEqual(index, -1, "missing workflow step: " + name);
  return index;
}

test("worker finalizes before observing and cleans state before fail gate", () => {
  const finalize = indexOfStep("Finalize target PR");
  const observe = indexOfStep("Observe current-head maintenance checks");
  const cleanup = indexOfStep("Cleanup worker state");
  const fail = indexOfStep("Fail workflow when OpenCode failed");

  assert.ok(finalize < observe);
  assert.ok(observe < cleanup);
  assert.ok(cleanup < fail);
});

test("observer runs only after a successful finalizer and never gets a workflow token grant", () => {
  assert.match(
    workflow,
    /Observe current-head maintenance checks[\s\S]*?if: always\(\) && steps\.finalize\.outcome == 'success'/,
  );
  assert.match(
    workflow,
    /Finalize target PR\n\s+id: finalize/,
  );
  assert.match(
    workflow,
    /Cleanup worker state\n\s+if: always\(\)/,
  );
  assert.match(workflow, /^permissions:\n\s+contents: read$/m);
  assert.doesNotMatch(workflow, /actions:\s*write/);
});
