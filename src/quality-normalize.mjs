const MAX_FIELD = 600;

const SEVERITY_MAP = new Map([
  ["blocker", "blocker"],
  ["critical", "critical"],
  ["error", "high"],
  ["high", "high"],
  ["major", "medium"],
  ["warning", "medium"],
  ["medium", "medium"],
  ["minor", "low"],
  ["low", "low"],
  ["info", "info"],
  ["informational", "info"],
  ["unknown", "unknown"],
]);

const STATE_MAP = new Map([
  ["added", "new"],
  ["new", "new"],
  ["worsened", "worsened"],
  ["existing", "existing"],
  ["unchanged", "existing"],
  ["fixed", "resolved"],
  ["resolved", "resolved"],
]);

function bounded(value, limit = MAX_FIELD) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= limit ? text : text.slice(0, limit) + "…";
}

function positiveLine(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function normalizeSeverity(value) {
  return SEVERITY_MAP.get(String(value || "unknown").toLowerCase()) || "unknown";
}

export function normalizeFindingState(value) {
  return STATE_MAP.get(String(value || "").toLowerCase()) || "unknown";
}

function sonarPath(raw) {
  if (raw.path) return bounded(raw.path);
  const component = String(raw.component || "");
  const separator = component.indexOf(":");
  return bounded(separator >= 0 ? component.slice(separator + 1) : component);
}

export function normalizeProviderFinding(source, raw) {
  const provider = String(source || "").toLowerCase();
  let finding;

  if (provider === "codacy") {
    const issue = raw?.commitIssue || raw || {};
    const pattern = issue.patternInfo || raw?.patternInfo || {};
    finding = {
      source: provider,
      category: "static-analysis",
      ruleId: bounded(pattern.id || raw?.ruleId || "unknown"),
      severity: normalizeSeverity(pattern.severityLevel || raw?.severity),
      state: normalizeFindingState(raw?.deltaType || raw?.state),
      message: bounded(issue.message || raw?.message),
      path: bounded(issue.filePath || raw?.path),
      line: positiveLine(issue.lineNumber || raw?.line),
      packageName: "",
      packageVersion: "",
      vulnerabilityId: "",
      cwe: bounded(raw?.cwe || pattern?.cwe),
      evidenceUrl: bounded(raw?.url || raw?.html_url),
    };
  } else if (provider === "sonar") {
    finding = {
      source: provider,
      category: "static-analysis",
      ruleId: bounded(raw?.rule || raw?.ruleId || "unknown"),
      severity: normalizeSeverity(raw?.severity),
      state: normalizeFindingState(raw?.state || raw?.deltaType),
      message: bounded(raw?.message),
      path: sonarPath(raw || {}),
      line: positiveLine(raw?.line),
      packageName: "",
      packageVersion: "",
      vulnerabilityId: bounded(raw?.vulnerabilityId || raw?.advisory),
      cwe: bounded(raw?.cwe),
      evidenceUrl: bounded(raw?.url || raw?.html_url),
    };
  } else if (provider === "semgrep") {
    finding = {
      source: provider,
      category: "static-analysis",
      ruleId: bounded(raw?.check_id || raw?.ruleId || "unknown"),
      severity: normalizeSeverity(raw?.extra?.severity || raw?.severity),
      state: normalizeFindingState(raw?.state || raw?.deltaType),
      message: bounded(raw?.extra?.message || raw?.message),
      path: bounded(raw?.path),
      line: positiveLine(raw?.start?.line || raw?.line),
      packageName: "",
      packageVersion: "",
      vulnerabilityId: bounded(raw?.vulnerabilityId || raw?.advisory),
      cwe: bounded(raw?.extra?.metadata?.cwe || raw?.cwe),
      evidenceUrl: bounded(raw?.extra?.metadata?.source || raw?.url),
    };
  } else if (provider === "osv" || provider === "trivy") {
    const packageInfo = raw?.package || raw?.pkg || {};
    finding = {
      source: provider,
      category: "dependency-vulnerability",
      ruleId: bounded(raw?.id || raw?.vulnerabilityId || raw?.advisory || "unknown"),
      severity: normalizeSeverity(raw?.severity || raw?.database_specific?.severity),
      state: normalizeFindingState(raw?.state || raw?.deltaType || "new"),
      message: bounded(raw?.summary || raw?.details || raw?.message),
      path: bounded(raw?.path || raw?.target),
      line: positiveLine(raw?.line),
      packageName: bounded(packageInfo.name || raw?.packageName || raw?.pkgName),
      packageVersion: bounded(packageInfo.version || raw?.packageVersion || raw?.installedVersion),
      vulnerabilityId: bounded(raw?.id || raw?.vulnerabilityId || raw?.advisory),
      cwe: bounded(raw?.cwe),
      evidenceUrl: bounded(raw?.url || raw?.references?.[0]?.url),
    };
  } else {
    finding = {
      source: provider || "unknown",
      category: bounded(raw?.category || "quality"),
      ruleId: bounded(raw?.ruleId || raw?.rule || "unknown"),
      severity: normalizeSeverity(raw?.severity),
      state: normalizeFindingState(raw?.state || raw?.deltaType),
      message: bounded(raw?.message),
      path: bounded(raw?.path),
      line: positiveLine(raw?.line),
      packageName: bounded(raw?.packageName),
      packageVersion: bounded(raw?.packageVersion),
      vulnerabilityId: bounded(raw?.vulnerabilityId),
      cwe: bounded(raw?.cwe),
      evidenceUrl: bounded(raw?.evidenceUrl || raw?.url),
    };
  }

  return {
    ...finding,
    fingerprint: findingFingerprint(finding),
    sources: [finding.source],
  };
}

function lineBucket(line) {
  return line ? Math.floor(Number(line) / 5) : 0;
}

export function findingFingerprint(finding) {
  const vulnerabilityId = bounded(finding?.vulnerabilityId).toUpperCase();
  const packageName = bounded(finding?.packageName).toLowerCase();
  if (vulnerabilityId) {
    return "vulnerability|" + vulnerabilityId + "|" + packageName;
  }

  const cwe = bounded(finding?.cwe).toUpperCase();
  const path = bounded(finding?.path).toLowerCase();
  if (cwe && path) {
    return "cwe|" + cwe + "|" + path + "|" + lineBucket(finding?.line);
  }

  return [
    "provider",
    bounded(finding?.source).toLowerCase(),
    bounded(finding?.ruleId).toLowerCase(),
    path,
    finding?.line || 0,
  ].join("|");
}

function severityRank(value) {
  return ["unknown", "info", "low", "medium", "high", "critical", "blocker"].indexOf(
    normalizeSeverity(value),
  );
}

function stateRank(value) {
  return ["unknown", "resolved", "existing", "new", "worsened"].indexOf(
    normalizeFindingState(value),
  );
}

export function deduplicateFindings(findings) {
  const grouped = new Map();
  for (const raw of findings || []) {
    const finding = raw?.fingerprint ? raw : {
      ...raw,
      fingerprint: findingFingerprint(raw),
      sources: raw?.sources || [raw?.source || "unknown"],
    };
    const current = grouped.get(finding.fingerprint);
    if (!current) {
      grouped.set(finding.fingerprint, {
        ...finding,
        sources: [...new Set(finding.sources || [finding.source])],
      });
      continue;
    }

    if (severityRank(finding.severity) > severityRank(current.severity)) {
      current.severity = normalizeSeverity(finding.severity);
    }
    if (stateRank(finding.state) > stateRank(current.state)) {
      current.state = normalizeFindingState(finding.state);
    }
    current.sources = [...new Set([
      ...(current.sources || []),
      ...(finding.sources || [finding.source]),
    ])];
    if (!current.message && finding.message) current.message = finding.message;
    if (!current.evidenceUrl && finding.evidenceUrl) current.evidenceUrl = finding.evidenceUrl;
  }
  return [...grouped.values()];
}

export function isFindingBlocking(finding, policy) {
  const state = normalizeFindingState(finding?.state);
  if (!["new", "worsened"].includes(state)) return false;
  const analyzer = policy?.analyzers?.[finding?.source];
  if (!analyzer) return false;
  if (analyzer.policy === "required") return true;
  return (analyzer.block_new || []).includes(normalizeSeverity(finding?.severity));
}
