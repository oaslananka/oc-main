import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

export async function runProcess(
  command,
  args,
  {
    cwd,
    env = process.env,
    timeoutMs = 300_000,
    maxOutputBytes = 2_000_000,
    rejectOnNonZero = true,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;

    const append = (target, decoder, chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        child.kill("SIGKILL");
        return target;
      }
      return target + decoder.write(chunk);
    };

    child.stdout.on("data", (chunk) => {
      stdout = append(stdout, stdoutDecoder, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, stderrDecoder, chunk);
    });

    const timer = setTimeout(() => {
      if (!settled) child.kill("SIGKILL");
    }, timeoutMs);

    child.on("error", (error) => {
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stdout += stdoutDecoder.end();
      stderr += stderrDecoder.end();

      if (outputBytes > maxOutputBytes) {
        reject(new Error(`${command} exceeded the output limit`));
        return;
      }
      if (signal === "SIGKILL") {
        reject(new Error(`${command} exceeded the time limit`));
        return;
      }
      if (code !== 0 && rejectOnNonZero) {
        const raw = stderr.trim() || stdout.trim() || "no process output";
        const detail = raw.length > 12_000
          ? "[process output truncated to final 12000 characters]\n" + raw.slice(-12_000)
          : raw;
        reject(new Error(`${command} failed with exit code ${code}: ${detail}`));
        return;
      }

      resolve({ stdout, stderr, code });
    });
  });
}
