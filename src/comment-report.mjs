const MAX_EXPLANATION_LENGTH = 3000;
const SAFE_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_SHA = /^[a-f0-9]{40}$/i;

function workflowLink(repository, runId) {
  if (!SAFE_REPOSITORY.test(String(repository || "")) ||
      !/^[1-9]\d{0,19}$/.test(String(runId || ""))) {
    return "See the GitHub Actions run for diagnostics.";
  }
  return "[Actions run](https://github.com/" + repository + "/actions/runs/" + runId + ")";
}

function reportHeading(state, job) {
  const label = state === "success" ? "Completed" :
    state === "failure" ? "Failed" :
    state === "incomplete" ? "Incomplete" : "Blocked";
  const titles = {
    maintenance: "Dependency maintenance",
    explain: "Repository explanation",
    plan: "Implementation planning",
    review: "Pull request review",
    security: "Security review",
    test: "Validation",
    ci: "CI remediation",
    refactor: "Refactoring",
    fix: "Issue remediation",
    apply: "Repository update",
    release: "Release preparation",
    research: "Repository research",
  };
  const title = Object.hasOwn(titles, job.mode) ? titles[job.mode] : "Repository task";
  return "**" + title + " — " + label + "**";
}

export function publicFailureReason(error) {
  const input = String(error || "");
  if (/exceeded the time limit/i.test(input)) return "Execution timed out";
  if (/exceeded the output limit/i.test(input)) return "Execution output limit exceeded";
  const rejected = input.match(/\b(?:failed with|returned) exit code (\d{1,3}) \(([a-z][a-z0-9-]{0,70})\)/i);
  if (rejected) {
    const reasons = {
      "unexplained-exit-one": "Unexpected process exit",
      "invalid-json-stream": "Invalid process output",
      "nonempty-stderr": "Process reported an error",
      "no-completed-text-after-error": "No final result after error",
      "missing-final-step-start": "Incomplete assistant result",
      "nonterminal-final-finish": "Process did not finish cleanly",
      "unexpected-exit-code": "Unexpected process exit",
    };
    const reason = Object.hasOwn(reasons, rejected[2]) ?
      reasons[rejected[2]] : "Process exited unsuccessfully";
    return reason + " (code " + rejected[1] + ")";
  }
  if (/without producing a result/i.test(input)) return "Worker result missing";
  return "Execution failed (see Actions for diagnostics)";
}

function safeExplanation(raw) {
  const value = String(raw || "").replace(/\x1b\[[0-9;]*m/g, "").trim();
  if (!value) return "No explanation was produced.";
  // Do not publish raw events, terminal transcripts, or diffs.
  if (/(^|\n)\s*(?:\{"(?:type|part|providerCall|providerResult|sessionID)"|diff --git |@@ -\d|[+-]{3} [ab]\/)/m.test(value)) {
    return "Output contained diagnostic data; consult the Actions run.";
  }
  const safe = value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
  return safe.length > MAX_EXPLANATION_LENGTH
    ? safe.slice(0, MAX_EXPLANATION_LENGTH) + "\n\n[Explanation truncated]"
    : safe;
}

export function renderRunComment({
  outcome,
  job,
  repository,
  runId,
  error,
  output,
  commitSha,
}) {
  const link = workflowLink(repository, runId);
  if (outcome === "failed") {
    return [
      reportHeading("failure", job),
      "- Reason: " + publicFailureReason(error),
      "- Changes pushed: No",
      "- Diagnostics: " + link,
    ].join("\n");
  }
  if (outcome === "incomplete") {
    return [
      reportHeading("incomplete", job),
      "- Reason: No tracked changes were produced or the task was blocked",
      "- Changes pushed: No",
      "- Diagnostics: " + link,
    ].join("\n");
  }
  if (outcome === "blocked-read-only") {
    return [
      reportHeading("blocked", job),
      "- Reason: Read-only task attempted tracked changes",
      "- Changes pushed: No",
      "- Diagnostics: " + link,
    ].join("\n");
  }
  if (outcome === "completed-no-changes") {
    return [
      reportHeading("success", job),
      "- Changes pushed: No (read-only)",
      "",
      safeExplanation(output),
      "",
      "Details: " + link,
    ].join("\n");
  }
  if (outcome === "pushed") {
    if (!SAFE_SHA.test(String(commitSha || ""))) {
      throw new Error("Cannot report a push without a valid commit SHA");
    }
    return [
      reportHeading("success", job),
      "- Commit: " + commitSha.slice(0, 7),
      "- Changes pushed: Yes",
      "- Validation: Refer to current PR checks; model claims are not CI evidence",
      "- Diagnostics: " + link,
    ].join("\n");
  }
  throw new Error("Unknown public report outcome");
}
