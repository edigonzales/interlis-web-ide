#!/usr/bin/env node

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SEMVER = /^\d+\.\d+\.\d+$/u;
const FULL_SHA = /^[0-9a-f]{40}$/u;
const CURRENT_SNAPSHOT = /^(\d+\.\d+\.\d+)-snapshot\.g([0-9a-f]{12})$/u;
const LEGACY_SNAPSHOT = /^(\d+\.\d+\.\d+)-SNAPSHOT\.\d{14}(?:\.\d+)?$/u;
const LANGUAGE_PACKAGES = [
  "@ilic/diagram",
  "@ilic/docx",
  "@ilic/language-service",
  "@ilic/monaco-adapter",
];

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function requireFullSha(value, name = "source SHA") {
  if (!FULL_SHA.test(value ?? "")) {
    throw new Error(`${name} must be a full 40-character lowercase Git SHA`);
  }
  return value;
}

export function parsePublishedVersion(value, sourceSha) {
  requireFullSha(sourceSha);
  if (SEMVER.test(value ?? "")) return { kind: "stable", baseVersion: value };
  const current = CURRENT_SNAPSHOT.exec(value ?? "");
  if (current) {
    if (current[2] !== sourceSha.slice(0, 12)) {
      throw new Error(`Snapshot ${value} does not match source SHA ${sourceSha}`);
    }
    return { kind: "snapshot", baseVersion: current[1], legacy: false };
  }
  const legacy = LEGACY_SNAPSHOT.exec(value ?? "");
  if (legacy) {
    return { kind: "snapshot", baseVersion: legacy[1], legacy: true };
  }
  throw new Error(`Unsupported exact published version ${String(value)}`);
}

export function snapshotVersion(baseVersion, sourceSha) {
  if (!SEMVER.test(baseVersion ?? "")) throw new Error("Base version must be X.Y.Z");
  return `${baseVersion}-snapshot.g${requireFullSha(sourceSha).slice(0, 12)}`;
}

export async function loadDependencyLock(projectRoot) {
  const lock = JSON.parse(
    await readFile(resolve(projectRoot, "release/dependencies.lock.json"), "utf8"),
  );
  if (lock.schemaVersion !== 1 || lock.project !== "interlis-web-ide") {
    throw new Error("Unsupported Web IDE dependency lock");
  }
  if (!SEMVER.test(lock.artifactBaseVersion ?? "")) {
    throw new Error("artifactBaseVersion must be X.Y.Z");
  }
  for (const [name, dependency] of Object.entries(lock.dependencies ?? {})) {
    if (!dependency || !["compiler", "languageTools"].includes(name)) {
      throw new Error(`Unsupported dependency ${name}`);
    }
    requireFullSha(dependency.sourceSha, `${name} source SHA`);
    const parsed = parsePublishedVersion(dependency.version, dependency.sourceSha);
    if (dependency.legacyWithoutDependencyLock && (!parsed.legacy || name !== "languageTools")) {
      throw new Error("legacyWithoutDependencyLock is allowed only for a legacy Language-Tools snapshot");
    }
  }
  if (!lock.dependencies?.compiler || !lock.dependencies?.languageTools) {
    throw new Error("The compiler and languageTools dependencies are required");
  }
  return lock;
}

function gitSha(directory) {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" }).trim();
}

function ilicBaseVersion(text) {
  const matches = [...text.matchAll(/project\s*\(\s*ilic\s+VERSION\s+(\d+\.\d+\.\d+)(?=\s|\))/giu)];
  if (matches.length !== 1) throw new Error("Expected one ilic project version");
  return matches[0][1];
}

function packageVersion(text, expectedName) {
  const manifest = JSON.parse(text);
  if (manifest.name !== expectedName || !SEMVER.test(manifest.version ?? "")) {
    throw new Error(`Unexpected ${expectedName} package manifest`);
  }
  return manifest.version;
}

export async function checkProject(projectRoot) {
  const lock = await loadDependencyLock(projectRoot);
  const manifest = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
  if (manifest.name !== "interlis-web-ide" || manifest.version !== lock.artifactBaseVersion) {
    throw new Error("package.json version must match the Web IDE artifactBaseVersion");
  }
  if (manifest.dependencies?.["@ilic/tools"] !== lock.dependencies.compiler.version) {
    throw new Error("@ilic/tools must use the exact locked compiler version");
  }
  for (const name of LANGUAGE_PACKAGES) {
    if (manifest.dependencies?.[name] !== lock.dependencies.languageTools.version) {
      throw new Error(`${name} must use the exact locked Language-Tools version`);
    }
  }
  return lock;
}

export async function verifyUpstreams({
  projectRoot,
  compilerRoot,
  languageToolsRoot,
  checkedCompilerSha,
  checkedLanguageToolsSha,
}) {
  const lock = await checkProject(projectRoot);
  const compiler = lock.dependencies.compiler;
  const language = lock.dependencies.languageTools;
  const actualCompilerSha = requireFullSha(checkedCompilerSha ?? gitSha(compilerRoot), "checked compiler SHA");
  const actualLanguageSha = requireFullSha(checkedLanguageToolsSha ?? gitSha(languageToolsRoot), "checked Language-Tools SHA");
  if (actualCompilerSha !== compiler.sourceSha) throw new Error("Checked compiler SHA does not match the lock");
  if (actualLanguageSha !== language.sourceSha) throw new Error("Checked Language-Tools SHA does not match the lock");

  const compilerVersion = parsePublishedVersion(compiler.version, compiler.sourceSha);
  const compilerBase = ilicBaseVersion(await readFile(resolve(compilerRoot, "CMakeLists.txt"), "utf8"));
  if (compilerVersion.baseVersion !== compilerBase) throw new Error("Compiler version does not match checked source base");
  const languageVersion = parsePublishedVersion(language.version, language.sourceSha);
  const languageBase = packageVersion(
    await readFile(resolve(languageToolsRoot, "package.json"), "utf8"),
    "interlis-language-tools-workspace",
  );
  if (languageVersion.baseVersion !== languageBase) throw new Error("Language-Tools version does not match checked source base");

  const nestedPath = resolve(languageToolsRoot, "release/dependencies.lock.json");
  if (existsSync(nestedPath)) {
    if (language.legacyWithoutDependencyLock) {
      throw new Error("Remove legacyWithoutDependencyLock when the selected source has a dependency lock");
    }
    const nested = JSON.parse(await readFile(nestedPath, "utf8"));
    const identities = new Set(
      Object.values(nested.dependencies ?? {}).map(({ version, sourceSha }) => `${version}@${sourceSha}`),
    );
    if (identities.size !== 1 || !identities.has(`${compiler.version}@${compiler.sourceSha}`)) {
      throw new Error("Language-Tools compiler lock does not match the Web IDE compiler lock");
    }
  } else if (!language.legacyWithoutDependencyLock) {
    throw new Error("Selected Language-Tools source has no dependency lock");
  }
  return lock;
}

async function readInstalledPackage(projectRoot, name, fromDirectory = projectRoot) {
  const resolver = createRequire(resolve(fromDirectory, "package.json"));
  let entry;
  try {
    entry = resolver.resolve(name);
  } catch (error) {
    throw new Error(
      `Installed package ${name} could not be resolved: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let packageRoot = dirname(entry);
  while (true) {
    const manifestPath = resolve(packageRoot, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      if (manifest.name === name) {
        return {
          root: packageRoot,
          manifest,
          releasePath: resolve(packageRoot, "interlis-release.json"),
        };
      }
    }
    const parent = dirname(packageRoot);
    if (parent === packageRoot) break;
    packageRoot = parent;
  }
  throw new Error(`Installed package ${name} has no matching package.json`);
}

function verifyInstalledPackage(packageInfo, expectedVersion, expectedSha) {
  const { name, version, gitHead } = packageInfo.manifest;
  if (name !== packageInfo.expectedName) {
    throw new Error(`Installed package name mismatch: expected ${packageInfo.expectedName}, found ${String(name)}`);
  }
  if (version !== expectedVersion) {
    throw new Error(`${packageInfo.expectedName} version does not match the locked version`);
  }
  requireFullSha(gitHead, `${packageInfo.expectedName} gitHead`);
  if (gitHead !== expectedSha) {
    throw new Error(`${packageInfo.expectedName} gitHead does not match the locked source SHA`);
  }
}

async function readInstalledRelease(packageInfo) {
  if (!existsSync(packageInfo.releasePath)) {
    throw new Error(`${packageInfo.expectedName} is missing interlis-release.json`);
  }
  return JSON.parse(await readFile(packageInfo.releasePath, "utf8"));
}

export async function verifyInstalled(projectRoot) {
  const lock = await checkProject(projectRoot);
  const compiler = lock.dependencies.compiler;
  const language = lock.dependencies.languageTools;
  const languagePackages = [];

  for (const name of LANGUAGE_PACKAGES) {
    const packageInfo = await readInstalledPackage(projectRoot, name);
    packageInfo.expectedName = name;
    verifyInstalledPackage(packageInfo, language.version, language.sourceSha);
    const release = await readInstalledRelease(packageInfo);
    requireFullSha(release.gitHead, `${name} release gitHead`);
    if (release.gitHead !== language.sourceSha) {
      throw new Error(`${name} release gitHead does not match the locked source SHA`);
    }
    if (!language.legacyWithoutDependencyLock) {
      for (const compilerName of ["@ilic/compiler-wasm", "@ilic/repository-core", "@ilic/tools"]) {
        const dependency = release.dependencies?.[compilerName];
        if (
          dependency?.version !== compiler.version ||
          dependency?.sourceSha !== compiler.sourceSha
        ) {
          throw new Error(`${name} release compiler dependency ${compilerName} does not match the Web IDE lock`);
        }
      }
    }
    languagePackages.push(packageInfo);
  }

  const tools = await readInstalledPackage(projectRoot, "@ilic/tools");
  tools.expectedName = "@ilic/tools";
  verifyInstalledPackage(tools, compiler.version, compiler.sourceSha);

  const languageService = languagePackages.find(
    ({ expectedName }) => expectedName === "@ilic/language-service",
  );
  const repositoryCore = await readInstalledPackage(
    projectRoot,
    "@ilic/repository-core",
    tools.root,
  );
  repositoryCore.expectedName = "@ilic/repository-core";
  verifyInstalledPackage(repositoryCore, compiler.version, compiler.sourceSha);

  const compilerWasm = await readInstalledPackage(
    projectRoot,
    "@ilic/compiler-wasm",
    languageService.root,
  );
  compilerWasm.expectedName = "@ilic/compiler-wasm";
  verifyInstalledPackage(compilerWasm, compiler.version, compiler.sourceSha);
  return lock;
}

export function assertStableDependencies(lock) {
  for (const [name, dependency] of Object.entries(lock.dependencies)) {
    if (!SEMVER.test(dependency.version)) {
      throw new Error(`Stable Web IDE releases require stable ${name}; found ${dependency.version}`);
    }
  }
}

export async function createReleaseManifest({ projectRoot, sourceSha, channel, runId, builtAt, toolchain }) {
  const lock = await checkProject(projectRoot);
  requireFullSha(sourceSha);
  if (!new Set(["snapshot", "stable"]).has(channel)) throw new Error("Channel must be snapshot or stable");
  if (channel === "stable") assertStableDependencies(lock);
  if (builtAt && Number.isNaN(Date.parse(builtAt))) throw new Error("builtAt must be ISO-8601");
  return {
    schemaVersion: 1,
    project: "interlis-web-ide",
    artifactVersion: channel === "stable" ? lock.artifactBaseVersion : snapshotVersion(lock.artifactBaseVersion, sourceSha),
    channel,
    sourceSha,
    dependencies: lock.dependencies,
    build: { githubRunId: runId || null, builtAt: builtAt || null, toolchain: toolchain || null },
  };
}

function parseArguments(argv) {
  const options = { projectRoot: resolve(import.meta.dirname, "..") };
  const command = argv.shift();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) throw new Error(`${flag} requires a value`);
    options[flag.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = value;
  }
  for (const key of ["projectRoot", "compilerRoot", "languageToolsRoot", "output"]) {
    if (options[key]) options[key] = resolve(options[key]);
  }
  return { command, options };
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (command === "check") {
    await checkProject(options.projectRoot);
    process.stdout.write("release metadata is consistent\n");
    return;
  }
  if (command === "verify-upstreams") {
    if (!options.compilerRoot || !options.languageToolsRoot) throw new Error("verify-upstreams requires both source roots");
    await verifyUpstreams(options);
    process.stdout.write("locked upstream sources are consistent\n");
    return;
  }
  if (command === "verify-installed") {
    await verifyInstalled(options.projectRoot);
    process.stdout.write("installed package provenance is consistent\n");
    return;
  }
  if (command === "export-github-output") {
    if (!options.output) throw new Error("export-github-output requires --output");
    const lock = await checkProject(options.projectRoot);
    await appendFile(options.output, [
      `artifact_base_version=${lock.artifactBaseVersion}`,
      `compiler_version=${lock.dependencies.compiler.version}`,
      `compiler_sha=${lock.dependencies.compiler.sourceSha}`,
      `language_tools_version=${lock.dependencies.languageTools.version}`,
      `language_tools_sha=${lock.dependencies.languageTools.sourceSha}`,
      `language_tools_legacy=${lock.dependencies.languageTools.legacyWithoutDependencyLock ? "true" : "false"}`,
      "",
    ].join("\n"));
    return;
  }
  if (command === "manifest") {
    if (!options.output || !options.sourceSha || !options.channel) throw new Error("manifest requires output, source-sha and channel");
    if (options.channel === "stable" && options.tag !== `v${(await checkProject(options.projectRoot)).artifactBaseVersion}`) {
      throw new Error("Stable release tag does not match the Web IDE base version");
    }
    const manifest = await createReleaseManifest({ ...options });
    await mkdir(dirname(options.output), { recursive: true });
    await writeFile(options.output, jsonText(manifest));
    return;
  }
  throw new Error("Expected check, verify-upstreams, verify-installed, export-github-output, or manifest");
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
