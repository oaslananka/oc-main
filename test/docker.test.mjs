import assert from "node:assert/strict";
import test from "node:test";
import { decodeDockerLogFrames } from "../src/docker.mjs";

function frame(stream, text) {
  const body = Buffer.from(text);
  const header = Buffer.alloc(8);
  header[0] = stream;
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

test("decodes Docker multiplexed stdout and stderr frames", () => {
  const output = decodeDockerLogFrames(
    Buffer.concat([
      frame(1, "hello\n"),
      frame(2, "warning\n"),
      frame(1, "done\n"),
    ]),
  );

  assert.equal(output.stdout, "hello\ndone\n");
  assert.equal(output.stderr, "warning\n");
});

test("falls back to raw output when logs are not multiplexed", () => {
  const output = decodeDockerLogFrames(Buffer.from("plain output\n"));
  assert.equal(output.stdout, "plain output\n");
  assert.equal(output.stderr, "");
});
