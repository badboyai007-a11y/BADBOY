import assert from "node:assert/strict";
import test from "node:test";
import { classifyDependencyFix, readNpmDependencies, scanNpmDependencies } from "./dependencyIntelligence.ts";

test("extracts exact npm versions and reports ranges as skipped instead of guessing", () => {
  const result = readNpmDependencies({
    dependencies: { safe: "1.2.3", range: "^2.0.0" },
    devDependencies: { tooling: "3.4.5" },
  });
  assert.deepEqual(result.dependencies, [{ name: "safe", version: "1.2.3" }, { name: "tooling", version: "3.4.5" }]);
  assert.equal(result.skipped, 1);
});

test("rejects malformed manifests", () => {
  assert.throws(() => readNpmDependencies(null), /PACKAGE_MANIFEST_INVALID/);
});

test("scans vulnerabilities through the OSV batch API without changing the manifest", async () => {
  let requestBody = "";
  const result = await scanNpmDependencies({ dependencies: { "demo-pkg": "1.0.0" } }, {
    fetchImpl: async (_url, init) => {
      requestBody = String(init?.body ?? "");
      return new Response(JSON.stringify({ results: [{ vulns: [{
        id: "GHSA-demo",
        summary: "Example vulnerability",
        database_specific: { severity: "HIGH" },
        affected: [{ ranges: [{ events: [{ introduced: "0" }, { fixed: "1.0.2" }] }] }],
        references: [{ url: "https://example.com/advisory" }],
      }] }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  assert.match(requestBody, /demo-pkg/);
  assert.equal(result.scanned, 1);
  assert.equal(result.findings[0].vulnerabilityId, "GHSA-demo");
  assert.equal(result.findings[0].severity, "high");
  assert.deepEqual(result.findings[0].fixedVersions, ["1.0.2"]);
  assert.deepEqual(result.errors, []);
});

test("reports major updates for human review and same-major updates as candidates", () => {
  assert.equal(classifyDependencyFix("1.2.3", "1.2.4"), "patch_or_minor_candidate");
  assert.equal(classifyDependencyFix("1.2.3", "1.9.0"), "patch_or_minor_candidate");
  assert.equal(classifyDependencyFix("1.2.3", "2.0.0"), "major_review_required");
  assert.equal(classifyDependencyFix("^1.2.3", "2.0.0"), "invalid_version");
});
