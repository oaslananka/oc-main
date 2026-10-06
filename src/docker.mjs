import http from "node:http";
import path from "node:path";

const DOCKER_API = "/v1.41";
const MAX_ENGINE_RESPONSE_BYTES = 8_000_000;

function safePathWithin(root, candidate, label) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const prefix = `${resolvedRoot}${path.sep}`;

  if (
    resolvedCandidate !== resolvedRoot &&
    !resolvedCandidate.startsWith(prefix)
  ) {
    throw new Error(`${label} is outside the configured work root`);
  }

  return resolvedCandidate;
}

function dockerRequest(
  socketPath,
  apiPath,
  { method = "GET", body, timeoutMs = 30_000, maxBytes = MAX_ENGINE_RESPONSE_BYTES } = {},
) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        socketPath,
        path: `${DOCKER_API}${apiPath}`,
        method,
        headers: payload
          ? {
              "Content-Type": "application/json",
              "Content-Length": String(payload.length),
            }
          : undefined,
      },
      (response) => {
        const chunks = [];
        let size = 0;

        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            request.destroy(new Error("Docker Engine response exceeded the size limit"));
            return;
          }
          chunks.push(chunk);
        });

        response.on("end", () => {
          const raw = Buffer.concat(chunks);
          const status = response.statusCode ?? 0;

          if (status < 200 || status >= 300) {
            let detail = raw.toString("utf8").trim();
            try {
              const parsed = JSON.parse(detail);
              detail = parsed.message || detail;
            } catch {
              // Keep the raw response text.
            }
            reject(
              new Error(
                `Docker Engine request failed (${status})${
                  detail ? `: ${detail}` : ""
                }`,
              ),
            );
            return;
          }

          resolve(raw);
        });
      },
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("Docker Engine request timed out"));
    });
    request.on("error", reject);

    if (payload) request.write(payload);
    request.end();
  });
}

function parseJson(buffer, label) {
  const text = buffer.toString("utf8").trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Docker Engine returned invalid JSON for ${label}`);
  }
}

export function decodeDockerLogFrames(buffer) {
  let offset = 0;
  let stdout = "";
  let stderr = "";

  while (offset + 8 <= buffer.length) {
    const stream = buffer[offset];
    const size = buffer.readUInt32BE(offset + 4);
    const start = offset + 8;
    const end = start + size;

    if ((stream !== 1 && stream !== 2) || end > buffer.length) {
      return { stdout: buffer.toString("utf8"), stderr: "" };
    }

    const text = buffer.subarray(start, end).toString("utf8");
    if (stream === 1) stdout += text;
    else stderr += text;
    offset = end;
  }

  if (offset !== buffer.length) {
    return { stdout: buffer.toString("utf8"), stderr: "" };
  }

  return { stdout, stderr };
}

async function removeContainer(socketPath, containerId) {
  try {
    await dockerRequest(
      socketPath,
      `/containers/${encodeURIComponent(containerId)}?force=1&v=1`,
      { method: "DELETE" },
    );
  } catch (error) {
    console.error("failed to remove OpenCode worker container", error);
  }
}

async function killContainer(socketPath, containerId) {
  try {
    await dockerRequest(
      socketPath,
      `/containers/${encodeURIComponent(containerId)}/kill`,
      { method: "POST" },
    );
  } catch {
    // The container may already have exited.
  }
}

export async function runDockerOpenCode({
  repositoryDir,
  homeDir,
  workRoot,
  dockerSocket,
  workerImage,
  model,
  prompt,
  timeoutMs,
}) {
  const safeRepositoryDir = safePathWithin(workRoot, repositoryDir, "repository path");
  const safeHomeDir = safePathWithin(workRoot, homeDir, "agent home path");
  const gitDir = path.join(safeRepositoryDir, ".git");

  const createBody = {
    Image: workerImage,
    Entrypoint: ["/usr/local/bin/opencode"],
    Cmd: ["run", "--model", model, prompt],
    WorkingDir: "/workspace",
    Env: [
      "HOME=/home/agent",
      "PATH=/usr/local/bin:/usr/bin:/bin",
      "CI=true",
      "NO_COLOR=1",
      "GIT_OPTIONAL_LOCKS=0",
      "LANG=C.UTF-8",
      "LC_ALL=C.UTF-8",
    ],
    AttachStdout: false,
    AttachStderr: false,
    OpenStdin: false,
    Tty: false,
    Labels: {
      "dev.oaslananka.oc-main.role": "opencode-worker",
    },
    HostConfig: {
      Binds: [
        `${safeRepositoryDir}:/workspace:rw`,
        `${gitDir}:/workspace/.git:ro`,
        `${safeHomeDir}:/home/agent:rw`,
      ],
      AutoRemove: false,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges"],
      ReadonlyRootfs: true,
      NetworkMode: "bridge",
      PidsLimit: 512,
      Memory: 4 * 1024 * 1024 * 1024,
      NanoCpus: 2_000_000_000,
      Tmpfs: {
        "/tmp": "rw,nosuid,nodev,noexec,size=268435456",
      },
    },
  };

  const created = parseJson(
    await dockerRequest(dockerSocket, "/containers/create", {
      method: "POST",
      body: createBody,
    }),
    "container creation",
  );
  const containerId = created.Id;
  if (!containerId) throw new Error("Docker Engine did not return a container ID");

  try {
    await dockerRequest(
      dockerSocket,
      `/containers/${encodeURIComponent(containerId)}/start`,
      { method: "POST" },
    );

    let waitResult;
    try {
      waitResult = parseJson(
        await dockerRequest(
          dockerSocket,
          `/containers/${encodeURIComponent(containerId)}/wait?condition=not-running`,
          { method: "POST", timeoutMs: timeoutMs + 5_000 },
        ),
        "container wait",
      );
    } catch (error) {
      await killContainer(dockerSocket, containerId);
      if (String(error?.message || error).includes("timed out")) {
        throw new Error("OpenCode worker exceeded the time limit");
      }
      throw error;
    }

    const logs = await dockerRequest(
      dockerSocket,
      `/containers/${encodeURIComponent(
        containerId,
      )}/logs?stdout=1&stderr=1&timestamps=0`,
      { maxBytes: 4_000_000 },
    );
    const output = decodeDockerLogFrames(logs);
    const statusCode = Number(waitResult.StatusCode ?? 1);

    if (statusCode !== 0) {
      const detail =
        output.stderr.trim() || output.stdout.trim() || `exit code ${statusCode}`;
      throw new Error(`opencode failed: ${detail}`);
    }

    return { ...output, code: statusCode };
  } finally {
    await removeContainer(dockerSocket, containerId);
  }
}
