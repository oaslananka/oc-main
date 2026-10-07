const MAX_POLICY_BYTES = 32_768;

const ANALYZER_NAMES = new Set([
  "codeql",
  "osv",
  "semgrep",
  "sonar",
  "codacy",
  "socket",
  "codecov",
  "trivy",
  "gitguardian",
  "npm-audit",
]);

const ANALYZER_POLICIES = new Set([
  "required",
  "advisory",
  "conditional",
  "coverage",
  "supply-chain",
]);

const SEVERITIES = new Set([
  "blocker",
  "critical",
  "high",
  "medium",
  "low",
  "info",
  "unknown",
]);

const TOP_LEVEL_SECTIONS = new Set([
  "campaign",
  "required_checks",
  "analyzers",
]);

const CAMPAIGN_KEYS = new Set([
  "max_iterations",
  "max_dependencies_per_batch",
]);

export const DEFAULT_MAINTENANCE_POLICY = Object.freeze({
  version: 1,
  campaign: Object.freeze({
    max_iterations: 4,
    max_dependencies_per_batch: 5,
  }),
  required_checks: Object.freeze({
    inherit_from_github: true,
    names: Object.freeze([]),
  }),
  analyzers: Object.freeze({
    codeql: Object.freeze({ policy: "required", block_new: Object.freeze(["critical", "high"]) }),
    osv: Object.freeze({ policy: "required", block_new: Object.freeze(["critical", "high", "medium", "low"]) }),
    semgrep: Object.freeze({ policy: "required", block_new: Object.freeze(["critical", "high"]) }),
    sonar: Object.freeze({ policy: "advisory", block_new: Object.freeze(["blocker", "critical"]) }),
    codacy: Object.freeze({ policy: "advisory", block_new: Object.freeze(["critical"]) }),
    socket: Object.freeze({ policy: "supply-chain", block_new: Object.freeze(["critical", "high"]) }),
    codecov: Object.freeze({ policy: "coverage", block_new: Object.freeze([]) }),
    trivy: Object.freeze({ policy: "conditional", block_new: Object.freeze(["critical", "high"]) }),
    gitguardian: Object.freeze({ policy: "required", block_new: Object.freeze(["critical", "high"]) }),
    "npm-audit": Object.freeze({ policy: "required", block_new: Object.freeze(["critical", "high"]) }),
  }),
});

function cloneDefaults() {
  return structuredClone(DEFAULT_MAINTENANCE_POLICY);
}

function scalar(raw, lineNumber) {
  const value = raw.trim();
  if (!value) throw new Error("Missing maintenance policy value on line " + lineNumber);
  if ("&*!{}[]|>".includes(value[0])) {
    throw new Error("Unsupported YAML feature on line " + lineNumber);
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  return value;
}

function keyValue(trimmed, lineNumber) {
  const index = trimmed.indexOf(":");
  if (index <= 0) throw new Error("Expected key:value on line " + lineNumber);
  const key = trimmed.slice(0, index).trim();
  if (!/^[a-z0-9_-]+$/i.test(key)) {
    throw new Error("Invalid maintenance policy key on line " + lineNumber);
  }
  return [key, trimmed.slice(index + 1).trim()];
}

function checkedInteger(value, name, minimum, maximum) {
  const numeric =
    typeof value === "string" && /^-?\\d+$/.test(value)
      ? Number.parseInt(value, 10)
      : value;
  if (!Number.isSafeInteger(numeric) || numeric < minimum || numeric > maximum) {
    throw new Error(name + " must be an integer between " + minimum + " and " + maximum);
  }
  return numeric;
}

function checkedStringList(values, name, { maxItems = 50, severities = false } = {}) {
  if (!Array.isArray(values) || values.length > maxItems) {
    throw new Error(name + " contains too many values");
  }
  const result = [];
  for (const raw of values) {
    const value = String(raw || "").trim();
    if (!value || value.length > 160) throw new Error("Invalid value in " + name);
    if (severities && !SEVERITIES.has(value.toLowerCase())) {
      throw new Error("Unsupported severity in " + name + ": " + value);
    }
    result.push(severities ? value.toLowerCase() : value);
  }
  return [...new Set(result)];
}

function createParsedPolicy() {
  return {
    version: null,
    campaign: {},
    required_checks: { names: [] },
    analyzers: {},
  };
}

function stripInlineComment(raw) {
  let quote = "";
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? "" : char;
      continue;
    }
    if (char === "#" && !quote && (index === 0 || /\\s/.test(raw[index - 1]))) {
      return raw.slice(0, index).trimEnd();
    }
  }
  return raw;
}

function parseLineShape(raw, lineNumber) {
  const uncommented = stripInlineComment(raw);
  if (!uncommented.trim()) return null;
  if (uncommented.includes("\t")) throw new Error("Tabs are not supported in maintenance policy");
  const indent = uncommented.length - uncommented.trimStart().length;
  if (indent % 2 !== 0 || indent > 6) {
    throw new Error("Maintenance policy indentation must use two spaces on line " + lineNumber);
  }
  return { indent, trimmed: uncommented.trim() };
}

function handleListItem(state, trimmed, lineNumber) {
  if (!trimmed.startsWith("- ")) return false;
  if (!state.listTarget) throw new Error("Unexpected list item on line " + lineNumber);
  state.listTarget.push(scalar(trimmed.slice(2), lineNumber));
  return true;
}

function handleTopLevel(parsed, state, trimmed, lineNumber) {
  const [key, value] = keyValue(trimmed, lineNumber);
  state.analyzer = null;
  state.listTarget = null;
  if (key === "version") {
    parsed.version = scalar(value, lineNumber);
    state.section = null;
    return;
  }
  if (!TOP_LEVEL_SECTIONS.has(key) || value) {
    throw new Error("Unsupported top-level maintenance policy key on line " + lineNumber);
  }
  state.section = key;
}

function handleCampaign(parsed, state, indent, trimmed, lineNumber) {
  state.listTarget = null;
  if (indent !== 2) throw new Error("Invalid campaign indentation on line " + lineNumber);
  const [key, value] = keyValue(trimmed, lineNumber);
  if (!CAMPAIGN_KEYS.has(key)) throw new Error("Unsupported campaign key: " + key);
  parsed.campaign[key] = scalar(value, lineNumber);
}

function handleRequiredChecks(parsed, state, indent, trimmed, lineNumber) {
  if (indent !== 2) {
    throw new Error(
      indent === 4
        ? "Required check list items must start with '- '"
        : "Invalid required_checks indentation on line " + lineNumber,
    );
  }

  const [key, value] = keyValue(trimmed, lineNumber);
  if (key === "inherit_from_github") {
    state.listTarget = null;
    parsed.required_checks.inherit_from_github = scalar(value, lineNumber);
    return;
  }
  if (key === "names" && !value) {
    state.listTarget = parsed.required_checks.names;
    return;
  }
  throw new Error("Unsupported required_checks key: " + key);
}

function handleAnalyzerSection(parsed, state, indent, trimmed, lineNumber) {
  if (indent === 2) {
    const [key, value] = keyValue(trimmed, lineNumber);
    if (value || !ANALYZER_NAMES.has(key)) {
      throw new Error("Unsupported analyzer policy: " + key);
    }
    state.analyzer = key;
    state.listTarget = null;
    parsed.analyzers[key] = { block_new: [] };
    return;
  }

  if (indent !== 4 || !state.analyzer) {
    throw new Error(
      indent === 6
        ? "Analyzer list items must start with '- '"
        : "Invalid analyzers indentation on line " + lineNumber,
    );
  }

  const [key, value] = keyValue(trimmed, lineNumber);
  if (key === "policy") {
    state.listTarget = null;
    parsed.analyzers[state.analyzer].policy = scalar(value, lineNumber);
    return;
  }
  if (key === "block_new" && !value) {
    state.listTarget = parsed.analyzers[state.analyzer].block_new;
    return;
  }
  throw new Error("Unsupported analyzer key: " + key);
}

function handleNestedLine(parsed, state, shape, lineNumber) {
  if (!state.section) {
    throw new Error("Nested maintenance policy value without section on line " + lineNumber);
  }
  if (state.section === "campaign") {
    handleCampaign(parsed, state, shape.indent, shape.trimmed, lineNumber);
    return;
  }
  if (state.section === "required_checks") {
    handleRequiredChecks(parsed, state, shape.indent, shape.trimmed, lineNumber);
    return;
  }
  handleAnalyzerSection(parsed, state, shape.indent, shape.trimmed, lineNumber);
}

function parsePolicyDocument(source) {
  const parsed = createParsedPolicy();
  const state = { section: null, analyzer: null, listTarget: null };
  const lines = source.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const shape = parseLineShape(lines[index], lineNumber);
    if (!shape) continue;
    if (handleListItem(state, shape.trimmed, lineNumber)) continue;
    if (shape.indent === 0) {
      handleTopLevel(parsed, state, shape.trimmed, lineNumber);
      continue;
    }
    handleNestedLine(parsed, state, shape, lineNumber);
  }
  return parsed;
}

function applyCampaignPolicy(policy, parsed) {
  policy.campaign.max_iterations = checkedInteger(
    parsed.campaign.max_iterations ?? policy.campaign.max_iterations,
    "campaign.max_iterations",
    1,
    8,
  );
  policy.campaign.max_dependencies_per_batch = checkedInteger(
    parsed.campaign.max_dependencies_per_batch ?? policy.campaign.max_dependencies_per_batch,
    "campaign.max_dependencies_per_batch",
    1,
    20,
  );
}

function applyRequiredChecksPolicy(policy, parsed) {
  const inherit = parsed.required_checks.inherit_from_github ?? true;
  if (inherit !== true) {
    throw new Error("required_checks.inherit_from_github must remain true");
  }
  policy.required_checks.inherit_from_github = true;
  policy.required_checks.names = checkedStringList(
    parsed.required_checks.names,
    "required_checks.names",
  );
}

function applyAnalyzerPolicies(policy, parsed) {
  for (const [name, override] of Object.entries(parsed.analyzers)) {
    const analyzer = policy.analyzers[name];
    if (override.policy !== undefined) {
      const value = String(override.policy).toLowerCase();
      if (!ANALYZER_POLICIES.has(value)) {
        throw new Error("Unsupported analyzer policy for " + name + ": " + value);
      }
      analyzer.policy = value;
    }
    if (override.block_new.length) {
      analyzer.block_new = checkedStringList(
        override.block_new,
        "analyzers." + name + ".block_new",
        { severities: true, maxItems: 8 },
      );
    }
  }
}

function validateParsedPolicy(parsed) {
  checkedInteger(parsed.version, "version", 1, 1);
  const policy = cloneDefaults();
  applyCampaignPolicy(policy, parsed);
  applyRequiredChecksPolicy(policy, parsed);
  applyAnalyzerPolicies(policy, parsed);
  return policy;
}

export function parseMaintenancePolicy(text) {
  const source = String(text ?? "");
  if (Buffer.byteLength(source, "utf8") > MAX_POLICY_BYTES) {
    throw new Error("Maintenance policy exceeds 32768 bytes");
  }
  return validateParsedPolicy(parsePolicyDocument(source));
}

export function resolveMaintenancePolicy(text, source = "builtin-default") {
  if (text === null || text === undefined || String(text).trim() === "") {
    return {
      policy: cloneDefaults(),
      source: "builtin-default",
      warning: "",
    };
  }
  try {
    return {
      policy: parseMaintenancePolicy(text),
      source,
      warning: "",
    };
  } catch (error) {
    return {
      policy: cloneDefaults(),
      source: "builtin-default",
      warning:
        "Ignored invalid maintenance policy from " +
        source +
        ": " +
        String(error?.message || error),
    };
  }
}
