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


test("runProcess reports the tail of long failures", async () => {
  await assert.rejects(
    runProcess(
      process.execPath,
      [
        "-e",
        "process.stderr.write('x'.repeat(14000) + 'TAIL_MARKER'); process.exit(7)",
      ],
      { maxOutputBytes: 100_000 },
    ),
    (error) => {
      assert.match(error.message, /exit code 7/);
      assert.match(error.message, /TAIL_MARKER/);
      assert.doesNotMatch(error.message, /^x{1000}/);
      return true;
    },
  );
});

test("runProcess can return a non-zero result for explicit callers", async () => {
  const result = await runProcess(
    process.execPath,
    [
      "-e",
      "process.stdout.write('stdout'); process.stderr.write('stderr'); process.exit(7)",
    ],
    { rejectOnNonZero: false },
  );

  assert.equal(result.code, 7);
  assert.equal(result.stdout, "stdout");
  assert.equal(result.stderr, "stderr");
});
