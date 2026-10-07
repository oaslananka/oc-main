import assert from "node:assert/strict";
import test from "node:test";
import { runProcess } from "../src/process.mjs";

test("runProcess preserves UTF-8 characters split across stream chunks", async () => {
  const script = [
    "const bytes = Buffer.from('😀');",
    "process.stdout.write(bytes.subarray(0, 2));",
    "setTimeout(() => process.stdout.write(bytes.subarray(2)), 10);",
  ].join("");

  const result = await runProcess(process.execPath, ["-e", script]);
  assert.equal(result.stdout, "😀");
});
