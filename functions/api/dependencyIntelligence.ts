export interface DependencyFinding {
  packageName: string;
  version: string;
  vulnerabilityId: string;
  summary: string;
  severity: "critical" | "high" | "medium" | "low" | "unknown";
  fixedVersions: string[];
  references: string[];
}

export interface DependencyScanResult {
  scanned: number;
  skipped: number;
  findings: DependencyFinding[];
  errors: string[];
  generatedAt: string;
}

type Manifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

function exactVersion(range: string): string | null {
  const value = range.trim().replace(/^v/u, "");
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(value) ? value : null;
}

function severityFromVulnerability(vulnerability: Record<string, unknown>): DependencyFinding["severity"] {
  const severity = Array.isArray(vulnerability.severity) ? vulnerability.severity as Array<Record<string, unknown>> : [];
  const scores = severity.map((item) => String(item.score ?? "").toLowerCase());
  const text = String(vulnerability.database_specific && typeof vulnerability.database_specific === "object"
    ? (vulnerability.database_specific as Record<string, unknown>).severity ?? "" : "").toLowerCase();
  const combined = [...scores, text].join(" ");
  if (combined.includes("critical")) return "critical";
  if (combined.includes("high")) return "high";
  if (combined.includes("moderate") || combined.includes("medium")) return "medium";
  if (combined.includes("low")) return "low";
  return "unknown";
}

function extractFixedVersions(vulnerability: Record<string, unknown>): string[] {
  const affected = Array.isArray(vulnerability.affected) ? vulnerability.affected as Array<Record<string, unknown>> : [];
  const fixed = new Set<string>();
  for (const item of affected) {
    const ranges = Array.isArray(item.ranges) ? item.ranges as Array<Record<string, unknown>> : [];
    for (const range of ranges) {
      const events = Array.isArray(range.events) ? range.events as Array<Record<string, unknown>> : [];
      for (const event of events) {
        if (typeof event.fixed === "string" && /^\d+\.\d+\.\d+/u.test(event.fixed)) fixed.add(event.fixed);
      }
    }
  }
  return [...fixed].sort();
}

export function readNpmDependencies(manifestInput: unknown): {
  dependencies: Array<{ name: string; version: string }>;
  skipped: number;
} {
  if (!manifestInput || typeof manifestInput !== "object" || Array.isArray(manifestInput)) {
    throw new Error("PACKAGE_MANIFEST_INVALID");
  }
  const manifest = manifestInput as Manifest;
  const merged = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.optionalDependencies,
  };
  const dependencies: Array<{ name: string; version: string }> = [];
  let skipped = 0;
  for (const [name, range] of Object.entries(merged)) {
    if (typeof range !== "string") { skipped += 1; continue; }
    const version = exactVersion(range);
    if (!version) { skipped += 1; continue; }
    dependencies.push({ name, version });
  }
  return { dependencies, skipped };
}

/** Bounded OSV batch scan. Non-exact semver ranges are reported as skipped,
 * never guessed; this scanner is read-only and never edits manifests or lockfiles.
 */
export async function scanNpmDependencies(
  manifestInput: unknown,
  options: { fetchImpl?: typeof fetch; maxPackages?: number } = {},
): Promise<DependencyScanResult> {
  const parsed = readNpmDependencies(manifestInput);
  const maxPackages = Math.max(1, Math.min(100, Math.floor(options.maxPackages ?? 100)));
  const selected = parsed.dependencies.slice(0, maxPackages);
  const skipped = parsed.skipped + Math.max(0, parsed.dependencies.length - selected.length);
  if (!selected.length) {
    return { scanned: 0, skipped, findings: [], errors: [], generatedAt: new Date().toISOString() };
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl("https://api.osv.dev/v1/querybatch", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      queries: selected.map(({ name, version }) => ({
        package: { ecosystem: "npm", name }, version,
      })),
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    return { scanned: selected.length, skipped, findings: [],
      errors: [`OSV_REQUEST_FAILED_${response.status}`], generatedAt: new Date().toISOString() };
  }
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { results?: unknown }).results)) {
    return { scanned: selected.length, skipped, findings: [],
      errors: ["OSV_RESPONSE_INVALID"], generatedAt: new Date().toISOString() };
  }
  const results = (payload as { results: Array<Record<string, unknown>> }).results;
  const findings: DependencyFinding[] = [];
  selected.forEach((dependency, index) => {
    const vulns = Array.isArray(results[index]?.vulns) ? results[index].vulns as Array<Record<string, unknown>> : [];
    for (const vulnerability of vulns) {
      findings.push({
        packageName: dependency.name,
        version: dependency.version,
        vulnerabilityId: String(vulnerability.id ?? "UNKNOWN"),
        summary: String(vulnerability.summary ?? vulnerability.details ?? "No advisory summary supplied").slice(0, 1000),
        severity: severityFromVulnerability(vulnerability),
        fixedVersions: extractFixedVersions(vulnerability),
        references: (Array.isArray(vulnerability.references) ? vulnerability.references : [])
          .map((reference) => reference && typeof reference === "object" ? (reference as Record<string, unknown>).url : null)
          .filter((url): url is string => typeof url === "string" && url.startsWith("https://"))
          .slice(0, 5),
      });
    }
  });
  return { scanned: selected.length, skipped, findings, errors: [], generatedAt: new Date().toISOString() };
}

/** Conservative update guidance: only patch/minor fixes within the same major are candidates.
 * Peer compatibility and lockfile resolution must still be verified by CI before applying.
 */
export function classifyDependencyFix(current: string, fixed: string): "patch_or_minor_candidate" | "major_review_required" | "invalid_version" {
  const currentMatch = /^(\d+)\.(\d+)\.(\d+)/u.exec(current);
  const fixedMatch = /^(\d+)\.(\d+)\.(\d+)/u.exec(fixed);
  if (!currentMatch || !fixedMatch) return "invalid_version";
  return currentMatch[1] === fixedMatch[1] ? "patch_or_minor_candidate" : "major_review_required";
}
