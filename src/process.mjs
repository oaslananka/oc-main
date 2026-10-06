import { spawn } from "node:child_process";

export async function runProcess(
  command,
  args,
  { cwd, env = process.env, timeoutMs = 300_000, maxOutputBytes = 2_000_000 } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;

    const append = (target, chunk) => {
      const text = chunk.toString("utf8");
      outputBytes += Buffer.byteLength(text);
      if (outputBytes > maxOutputBytes) {
        child.kill("SIGKILL");
        return target;
      }
      return target + text;
    };

    child.stdout.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, chunk);
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

      if (outputBytes > maxOutputBytes) {
        reject(new Error(`${command} exceeded the output limit`));
        return;
      }
      if (signal === "SIGKILL") {
        reject(new Error(`${command} exceeded the time limit`));
        return;
      }
      if (code !== 0) {
        const detail = stderr.trim() || stdout.trim() || `exit code ${code}`;
        reject(new Error(`${command} failed: ${detail}`));
        return;
      }

      resolve({ stdout, stderr, code });
    });
  });
}
