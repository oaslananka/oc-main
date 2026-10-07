function bounded(value, limit = 600) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= limit ? text : text.slice(0, limit) + "…";
}

export function providerForCheckName(name) {
  const value = String(name || "").toLowerCase();
  if (value.includes("codacy")) return "codacy";
  if (value.includes("sonar")) return "sonar";
  if (value.includes("semgrep")) return "semgrep";
  if (value.includes("osv")) return "osv";
  if (value.includes("codeql") || value.includes("analyze javascript")) return "codeql";
  if (value.includes("socket")) return "socket";
  if (value.includes("codecov") || value.includes("coverage")) return "codecov";
  if (value.includes("trivy")) return "trivy";
  if (value.includes("gitguardian")) return "gitguardian";
  if (value.includes("npm audit") || value.includes("production-audit")) return "npm-audit";
  return "github";
}

export function normalizeCheckState(status, conclusion) {
  const liveStatus = String(status || "").toLowerCase();
  if (liveStatus !== "completed") return "pending";
  const value = String(conclusion || "").toLowerCase();
  if (["success", "neutral", "skipped"].includes(value)) return "success";
  if (value === "cancelled") return "cancelled";
  if (!value) return "pending";
  return "failure";
}

export function normalizeCheckRun(run) {
  const name = bounded(run?.name || "unnamed-check", 200);
  return {
    type: "check",
    name,
    key: name.toLowerCase(),
    source: providerForCheckName(name),
    state: normalizeCheckState(run?.status, run?.conclusion),
    status: bounded(run?.status || "unknown", 40),
    conclusion: bounded(run?.conclusion || "", 40),
    title: bounded(run?.output?.title || "", 300),
    summary: bounded(run?.output?.summary || "", 1200),
    url: bounded(run?.html_url || run?.details_url || "", 500),
    delta: "unknown",
    requiredBy: [],
    blocking: false,
  };
}

function strongestByName(runs) {
  const map = new Map();
  for (const raw of runs || []) {
    const run = raw?.type === "check" ? raw : normalizeCheckRun(raw);
    const current = map.get(run.key);
    if (!current) {
      map.set(run.key, run);
      continue;
    }
    const rank = new Map([
      ["failure", 4],
      ["cancelled", 3],
      ["pending", 2],
      ["success", 1],
    ]);
    if ((rank.get(run.state) || 0) > (rank.get(current.state) || 0)) {
      map.set(run.key, run);
    }
  }
  return map;
}

function deltaFor(candidate, base) {
  if (!base) return "unknown";
  if (candidate.state === "failure" || candidate.state === "cancelled") {
    if (base.state === "success") return "new";
    if (base.state === "failure" || base.state === "cancelled") return "existing";
    return "unknown";
  }
  if (candidate.state === "success" && (base.state === "failure" || base.state === "cancelled")) {
    return "resolved";
  }
  if (candidate.state === base.state) return candidate.state === "success" ? "unchanged" : "existing";
  return "unknown";
}

function normalizedNameSet(values) {
  return new Set((values || []).map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));
}

export function classifyCheckEvidence({
  candidateRuns = [],
  baseRuns = [],
  liveRequiredCheckNames = [],
  policyRequiredCheckNames = [],
  policy,
} = {}) {
  const candidateMap = strongestByName(candidateRuns);
  const baseMap = strongestByName(baseRuns);
  const liveRequired = normalizedNameSet(liveRequiredCheckNames);
  const policyRequired = normalizedNameSet(policyRequiredCheckNames);
  const evidence = [];

  for (const candidate of candidateMap.values()) {
    const requiredBy = [];
    if (liveRequired.has(candidate.key)) requiredBy.push("github-live");
    if (policyRequired.has(candidate.key)) requiredBy.push("repository-policy");
    if (policy?.analyzers?.[candidate.source]?.policy === "required") {
      requiredBy.push("analyzer-policy");
    }

    const state = candidate.state;
    evidence.push({
      ...candidate,
      delta: deltaFor(candidate, baseMap.get(candidate.key)),
      requiredBy,
      blocking:
        requiredBy.length > 0 &&
        ["failure", "cancelled"].includes(state),
    });
  }

  const seen = new Set(evidence.map((item) => item.key));
  for (const name of new Set([...liveRequired, ...policyRequired])) {
    if (seen.has(name)) continue;
    evidence.push({
      type: "check",
      name,
      key: name,
      source: providerForCheckName(name),
      state: "missing",
      status: "missing",
      conclusion: "",
      title: "",
      summary: "",
      url: "",
      delta: "unknown",
      requiredBy: [
        ...(liveRequired.has(name) ? ["github-live"] : []),
        ...(policyRequired.has(name) ? ["repository-policy"] : []),
      ],
      blocking: true,
    });
  }

  evidence.sort((a, b) => {
    if (a.blocking !== b.blocking) return a.blocking ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const required = evidence.filter((item) => item.requiredBy.length > 0);
  const requiredReady = required.every((item) => item.state === "success");
  return {
    checks: evidence,
    summary: {
      candidateCount: evidence.length,
      requiredCount: required.length,
      blockingCount: evidence.filter((item) => item.blocking).length,
      pendingRequiredCount: required.filter((item) => item.state === "pending").length,
      missingRequiredCount: required.filter((item) => item.state === "missing").length,
      requiredReady,
    },
  };
}
