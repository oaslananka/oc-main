const MAX_FINDINGS = 25;
const MAX_TEXT = 600;

function repositoryParts(repository) {
  const parts = String(repository || "").split("/");
  if (
    parts.length !== 2 ||
    parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part))
  ) {
    throw new Error("Invalid repository for quality context");
  }
  return parts;
}

function positivePullNumber(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error("Invalid pull request number for quality context");
  }
  return number;
}

function bounded(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= MAX_TEXT ? text : text.slice(0, MAX_TEXT) + "…";
}

export function codacyPullRequestIssuesUrl(repository, pullNumber) {
  const [owner, name] = repositoryParts(repository);
  const number = positivePullNumber(pullNumber);
  return (
    "https://api.codacy.com/api/v3/analysis/organizations/gh/" +
    encodeURIComponent(owner) +
    "/repositories/" +
    encodeURIComponent(name) +
    "/pull-requests/" +
    number +
    "/issues"
  );
}

export function formatCodacyQualityContext(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const findings = rows
    .filter((entry) => entry?.deltaType === "Added" && entry?.commitIssue)
    .slice(0, MAX_FINDINGS)
    .map((entry) => {
      const issue = entry.commitIssue;
      const pattern = issue.patternInfo || {};
      return {
        path: bounded(issue.filePath),
        line: Number.isSafeInteger(Number(issue.lineNumber))
          ? Number(issue.lineNumber)
          : null,
        severity: bounded(pattern.severityLevel || "unknown"),
        pattern: bounded(pattern.id || "unknown"),
        message: bounded(issue.message),
        lineText: bounded(issue.lineText),
      };
    });

  if (findings.length === 0) {
    return "Codacy public PR analysis reported no newly added findings.";
  }

  const lines = [
    "Codacy public PR analysis: " + findings.length + " newly added finding(s).",
  ];
  for (const finding of findings) {
    const location =
      finding.path + (finding.line ? ":" + finding.line : "");
    lines.push(
      "- [" +
        finding.severity +
        "] " +
        finding.pattern +
        " at " +
        location +
        " — " +
        finding.message +
        (finding.lineText ? " | source: " + finding.lineText : ""),
    );
  }
  return lines.join("\n");
}

export async function fetchCodacyQualityContext(
  repository,
  pullNumber,
  { fetchImpl = globalThis.fetch, timeoutMs = 8_000 } = {},
) {
  if (typeof fetchImpl !== "function") {
    return "Codacy context unavailable: fetch API is not available.";
  }

  const url = codacyPullRequestIssuesUrl(repository, pullNumber);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      return "Codacy context unavailable: HTTP " + response.status + ".";
    }
    return formatCodacyQualityContext(await response.json());
  } catch (error) {
    const message =
      error?.name === "AbortError"
        ? "request timed out"
        : bounded(error?.message || error || "request failed");
    return "Codacy context unavailable: " + message + ".";
  } finally {
    clearTimeout(timer);
  }
}
