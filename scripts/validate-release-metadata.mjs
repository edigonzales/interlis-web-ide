#!/usr/bin/env node

import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function validateTimestamp(value, fieldName) {
  if (!/^\d{14}$/.test(value ?? "")) {
    throw new Error(`${fieldName} must use UTC format YYYYMMDDHHmmss`);
  }
  const parts = [
    Number(value.slice(0, 4)),
    Number(value.slice(4, 6)),
    Number(value.slice(6, 8)),
    Number(value.slice(8, 10)),
    Number(value.slice(10, 12)),
    Number(value.slice(12, 14)),
  ];
  const date = new Date(
    Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]),
  );
  const normalized =
    `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}` +
    `${String(date.getUTCDate()).padStart(2, "0")}${String(date.getUTCHours()).padStart(2, "0")}` +
    `${String(date.getUTCMinutes()).padStart(2, "0")}${String(date.getUTCSeconds()).padStart(2, "0")}`;
  if (parts[0] < 2000 || normalized !== value) {
    throw new Error(`${fieldName} is not a valid UTC timestamp: ${value}`);
  }
  return value;
}

function validateBuildId(value, fieldName, { required = true } = {}) {
  if (!required && (value === undefined || value === null || value === "")) {
    return undefined;
  }
  const normalized = String(value ?? "");
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${fieldName} must contain only digits`);
  }
  return normalized;
}

export function parseSemanticVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value ?? "");
  if (!match) {
    throw new Error(`Semantic version must use X.Y.Z, received ${String(value)}`);
  }
  return {
    version: value,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function parseCompilerVersion(value) {
  if (/^\d+\.\d+\.\d+$/.test(value ?? "")) {
    return { kind: "stable", baseVersion: value, version: value };
  }
  const match = /^(\d+\.\d+\.\d+)-SNAPSHOT\.(\d{14})(?:\.(\d+))?$/.exec(
    value ?? "",
  );
  if (!match) {
    throw new Error(
      `Compiler version must be X.Y.Z or X.Y.Z-SNAPSHOT.YYYYMMDDHHmmss[.buildId], received ${String(value)}`,
    );
  }
  validateTimestamp(match[2], "Compiler timestamp");
  return {
    kind: "snapshot",
    baseVersion: match[1],
    timestamp: match[2],
    buildId: match[3],
    version: value,
  };
}

export function parseLanguageToolsVersion(value) {
  const match = /^(\d+\.\d+\.\d+)-SNAPSHOT\.(\d{14})(?:\.(\d+))?$/.exec(
    value ?? "",
  );
  if (!match) {
    throw new Error(
      `Language-tools version must be X.Y.Z-SNAPSHOT.YYYYMMDDHHmmss[.buildId], received ${String(value)}`,
    );
  }
  validateTimestamp(match[2], "Language-tools timestamp");
  return {
    baseVersion: match[1],
    timestamp: match[2],
    buildId: match[3],
    version: value,
  };
}

export function validateFullSha(value, fieldName) {
  if (!/^[0-9a-f]{40}$/.test(value ?? "")) {
    throw new Error(`${fieldName} must be a full 40-character lowercase SHA`);
  }
  return value;
}

export function readIlicProjectVersion(cmakeText) {
  const matches = [
    ...cmakeText.matchAll(
      /project\s*\(\s*ilic\s+VERSION\s+(\d+\.\d+\.\d+)(?=\s|\))/gi,
    ),
  ];
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one project(ilic VERSION X.Y.Z ...) declaration, found ${matches.length}`,
    );
  }
  return matches[0][1];
}

export function readLanguageToolsProjectVersion(packageText) {
  let manifest;
  try {
    manifest = JSON.parse(packageText);
  } catch {
    throw new Error("Language-tools package.json is not valid JSON");
  }
  if (manifest.name !== "interlis-language-tools-workspace") {
    throw new Error(
      `Unexpected language-tools workspace package name ${String(manifest.name)}`,
    );
  }
  return parseSemanticVersion(manifest.version).version;
}

export function validateReleaseMetadata(input) {
  const compilerSha = validateFullSha(input.compilerSha, "compiler_sha");
  const languageToolsSha = validateFullSha(
    input.languageToolsSha,
    "language_tools_sha",
  );
  const checkedOutCompilerSha = validateFullSha(
    input.checkedOutCompilerSha,
    "checked-out compiler SHA",
  );
  const checkedOutLanguageToolsSha = validateFullSha(
    input.checkedOutLanguageToolsSha,
    "checked-out language-tools SHA",
  );
  if (compilerSha !== checkedOutCompilerSha) {
    throw new Error(
      `compiler_sha ${compilerSha} does not match checked-out compiler SHA ${checkedOutCompilerSha}`,
    );
  }
  if (languageToolsSha !== checkedOutLanguageToolsSha) {
    throw new Error(
      `language_tools_sha ${languageToolsSha} does not match checked-out language-tools SHA ${checkedOutLanguageToolsSha}`,
    );
  }

  const checkedOutCompilerBaseVersion = parseSemanticVersion(
    input.checkedOutCompilerBaseVersion,
  ).version;
  const compiler = parseCompilerVersion(input.compilerVersion);
  if (compiler.baseVersion !== checkedOutCompilerBaseVersion) {
    throw new Error(
      `Compiler version ${compiler.version} has base ${compiler.baseVersion}, but checked-out ilic source has base ${checkedOutCompilerBaseVersion}`,
    );
  }

  let compilerTimestamp = "";
  let compilerBuildId = "";
  if (compiler.kind === "snapshot") {
    compilerTimestamp = validateTimestamp(
      input.compilerTimestamp,
      "compiler_timestamp",
    );
    compilerBuildId = validateBuildId(
      input.compilerBuildId,
      "compiler_build_id",
      { required: compiler.buildId !== undefined },
    ) ?? "";
    if (compilerTimestamp !== compiler.timestamp) {
      throw new Error(
        `compiler_timestamp ${compilerTimestamp} does not match compiler version timestamp ${compiler.timestamp}`,
      );
    }
    if ((compiler.buildId ?? "") !== compilerBuildId) {
      throw new Error(
        `compiler_build_id ${compilerBuildId || "<empty>"} does not match compiler version build ID ${compiler.buildId ?? "<empty>"}`,
      );
    }
  } else if (input.compilerTimestamp || input.compilerBuildId) {
    throw new Error(
      "Stable compiler metadata must not contain compiler_timestamp or compiler_build_id",
    );
  }

  const languageTools = parseLanguageToolsVersion(input.languageToolsVersion);
  const checkedOutLanguageToolsBaseVersion = parseSemanticVersion(
    input.checkedOutLanguageToolsBaseVersion,
  ).version;
  if (languageTools.baseVersion !== checkedOutLanguageToolsBaseVersion) {
    throw new Error(
      `Language-tools version ${languageTools.version} has base ${languageTools.baseVersion}, but checked-out language-tools source has base ${checkedOutLanguageToolsBaseVersion}`,
    );
  }
  const languageTimestamp = validateTimestamp(
    input.languageTimestamp,
    "language_timestamp",
  );
  const languageBuildId = validateBuildId(
    input.languageBuildId,
    "language_build_id",
  );
  if (languageTools.timestamp !== languageTimestamp) {
    throw new Error(
      `language_timestamp ${languageTimestamp} does not match language-tools version timestamp ${languageTools.timestamp}`,
    );
  }
  if ((languageTools.buildId ?? "") !== languageBuildId) {
    throw new Error(
      `language_build_id ${languageBuildId} does not match language-tools version build ID ${languageTools.buildId ?? "<empty>"}`,
    );
  }
  const releaseRunId = validateBuildId(input.releaseRunId, "release_run_id");

  return {
    compilerSha,
    languageToolsSha,
    compilerVersion: compiler.version,
    compilerVersionKind: compiler.kind,
    compilerBaseVersion: compiler.baseVersion,
    compilerTimestamp,
    compilerBuildId,
    languageToolsVersion: languageTools.version,
    languageTimestamp,
    languageBuildId,
    releaseRunId,
  };
}

function parseArguments(argv) {
  const values = {};
  const names = new Map([
    ["--compiler-sha", "compilerSha"],
    ["--language-tools-sha", "languageToolsSha"],
    ["--compiler-version", "compilerVersion"],
    ["--language-tools-version", "languageToolsVersion"],
    ["--compiler-timestamp", "compilerTimestamp"],
    ["--compiler-build-id", "compilerBuildId"],
    ["--language-timestamp", "languageTimestamp"],
    ["--language-build-id", "languageBuildId"],
    ["--release-run-id", "releaseRunId"],
    ["--checked-out-compiler-sha", "checkedOutCompilerSha"],
    ["--checked-out-language-tools-sha", "checkedOutLanguageToolsSha"],
  ]);
  let compilerCmake;
  let languageToolsPackage;
  let githubOutput;
  for (let index = 0; index < argv.length; index += 2) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`${argument} requires a value`);
    if (argument === "--compiler-cmake") compilerCmake = resolve(value);
    else if (argument === "--language-tools-package") {
      languageToolsPackage = resolve(value);
    }
    else if (argument === "--github-output") githubOutput = resolve(value);
    else if (names.has(argument)) values[names.get(argument)] = value;
    else throw new Error(`Unknown argument ${argument}`);
  }
  if (!compilerCmake) throw new Error("--compiler-cmake is required");
  if (!languageToolsPackage) {
    throw new Error("--language-tools-package is required");
  }
  return { values, compilerCmake, languageToolsPackage, githubOutput };
}

async function main() {
  const { values, compilerCmake, languageToolsPackage, githubOutput } = parseArguments(
    process.argv.slice(2),
  );
  values.checkedOutCompilerBaseVersion = readIlicProjectVersion(
    await readFile(compilerCmake, "utf8"),
  );
  values.checkedOutLanguageToolsBaseVersion =
    readLanguageToolsProjectVersion(
      await readFile(languageToolsPackage, "utf8"),
    );
  const result = validateReleaseMetadata(values);
  if (githubOutput) {
    await appendFile(
      githubOutput,
      `${Object.entries(result)
        .map(([name, value]) => `${name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}=${value}`)
        .join("\n")}\n`,
    );
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
