import assert from "node:assert/strict";
import test from "node:test";

import {
  parseCompilerVersion,
  readIlicProjectVersion,
  readLanguageToolsProjectVersion,
  validateReleaseMetadata,
} from "../../scripts/validate-release-metadata.mjs";

const compilerSha = "a".repeat(40);
const languageToolsSha = "b".repeat(40);

function metadata(overrides = {}) {
  return {
    compilerSha,
    languageToolsSha,
    compilerVersion: "0.9.10-SNAPSHOT.20260804120000.123456",
    compilerTimestamp: "20260804120000",
    compilerBuildId: "123456",
    languageToolsVersion: "0.1.1-SNAPSHOT.20260804130000.234567",
    languageTimestamp: "20260804130000",
    languageBuildId: "234567",
    releaseRunId: "345678",
    checkedOutCompilerSha: compilerSha,
    checkedOutLanguageToolsSha: languageToolsSha,
    checkedOutCompilerBaseVersion: "0.9.10",
    checkedOutLanguageToolsBaseVersion: "0.1.1",
    ...overrides,
  };
}

test("accepts stable compiler metadata for the checked-out source", () => {
  const result = validateReleaseMetadata(
    metadata({
      compilerVersion: "0.9.10",
      compilerTimestamp: "",
      compilerBuildId: "",
    }),
  );
  assert.equal(result.compilerVersionKind, "stable");
  assert.equal(result.compilerBaseVersion, "0.9.10");
});

test("accepts compiler snapshots with and without a numeric build ID", () => {
  assert.equal(validateReleaseMetadata(metadata()).compilerVersionKind, "snapshot");
  const result = validateReleaseMetadata(
    metadata({
      compilerVersion: "0.9.10-SNAPSHOT.20260804120000",
      compilerBuildId: "",
    }),
  );
  assert.equal(result.compilerBuildId, "");
});

test("rejects compiler versions that do not match the checked-out source", () => {
  for (const compilerVersion of [
    "0.9.9-SNAPSHOT.20260804120000.123456",
    "0.9.9",
    "0.9.11",
  ]) {
    assert.throws(
      () => validateReleaseMetadata(metadata({ compilerVersion })),
      /checked-out ilic source has base 0\.9\.10/i,
    );
  }
});

test("rejects language-tools versions that do not match the checked-out source", () => {
  assert.throws(
    () =>
      validateReleaseMetadata(
        metadata({
          languageToolsVersion: "0.2.0-SNAPSHOT.20260804130000.234567",
        }),
      ),
    /checked-out language-tools source has base 0\.1\.1/i,
  );
});

test("rejects malformed compiler versions and impossible timestamps", () => {
  for (const compilerVersion of [
    "v0.9.10",
    "0.9.10-SNAPSHOT.invalid",
    "0.9.10-SNAPSHOT.20260230120000",
  ]) {
    assert.throws(
      () => parseCompilerVersion(compilerVersion),
      /compiler version|timestamp/i,
    );
  }
});

test("rejects incomplete and mismatched SHAs", () => {
  assert.throws(
    () => validateReleaseMetadata(metadata({ compilerSha: "abc" })),
    /40-character/i,
  );
  assert.throws(
    () =>
      validateReleaseMetadata(
        metadata({ checkedOutLanguageToolsSha: "c".repeat(40) }),
      ),
    /does not match checked-out language-tools SHA/i,
  );
});

test("rejects missing or inconsistent build metadata", () => {
  assert.throws(
    () => validateReleaseMetadata(metadata({ languageTimestamp: "" })),
    /language_timestamp/i,
  );
  assert.throws(
    () => validateReleaseMetadata(metadata({ languageBuildId: "build" })),
    /language_build_id/i,
  );
  assert.throws(
    () => validateReleaseMetadata(metadata({ releaseRunId: "" })),
    /release_run_id/i,
  );
  assert.throws(
    () => validateReleaseMetadata(metadata({ compilerBuildId: "999" })),
    /does not match compiler version build ID/i,
  );
});

test("reads exactly one ilic CMake project version", () => {
  assert.equal(
    readIlicProjectVersion(
      "cmake_minimum_required(VERSION 3.20)\nproject(ilic VERSION 0.9.10 LANGUAGES C CXX)\n",
    ),
    "0.9.10",
  );
  assert.throws(() => readIlicProjectVersion("project(other VERSION 1.0.0)"));
  assert.throws(() =>
    readIlicProjectVersion(
      "project(ilic VERSION 0.9.10)\nproject(ilic VERSION 0.9.11)\n",
    ),
  );
});

test("reads the language-tools workspace version", () => {
  assert.equal(
    readLanguageToolsProjectVersion(
      '{"name":"interlis-language-tools-workspace","version":"0.1.1"}',
    ),
    "0.1.1",
  );
  assert.throws(() => readLanguageToolsProjectVersion("not-json"));
  assert.throws(() =>
    readLanguageToolsProjectVersion('{"name":"other","version":"0.1.1"}'),
  );
});
