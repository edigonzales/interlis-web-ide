import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  assertStableDependencies,
  checkProject,
  createReleaseManifest,
  parsePublishedVersion,
  snapshotVersion,
  verifyUpstreams,
} from "../../scripts/release-metadata.mjs";
import { renderLocalWorkspace } from "../../scripts/render-local-workspace.mjs";

const root = resolve(import.meta.dirname, "../..");
const webSha = "0123456789abcdef0123456789abcdef01234567";

test("checks the committed Web IDE contract without sibling tarballs", async () => {
  const lock = await checkProject(root);
  assert.equal(lock.artifactBaseVersion, "0.1.0");
  assert.equal(lock.dependencies.languageTools.legacyWithoutDependencyLock, undefined);
});

test("derives deterministic Web IDE snapshots", () => {
  assert.equal(snapshotVersion("0.1.0", webSha), "0.1.0-snapshot.g0123456789ab");
  assert.throws(() => snapshotVersion("0.1", webSha));
});

test("accepts the immutable legacy dependency form but validates new SHA snapshots", () => {
  assert.equal(parsePublishedVersion("0.1.2-SNAPSHOT.20260826044748.32930961069", "a".repeat(40)).legacy, true);
  assert.equal(parsePublishedVersion("0.1.2-snapshot.gaaaaaaaaaaaa", "a".repeat(40)).legacy, false);
  assert.throws(() => parsePublishedVersion("0.1.2-snapshot.gbbbbbbbbbbbb", "a".repeat(40)), /does not match/u);
});

test("creates complete snapshot provenance and rejects stable snapshot dependencies", async () => {
  const manifest = await createReleaseManifest({
    projectRoot: root,
    sourceSha: webSha,
    channel: "snapshot",
    runId: "42",
    builtAt: "2026-08-30T12:00:00Z",
    toolchain: "node-22",
  });
  assert.equal(manifest.artifactVersion, "0.1.0-snapshot.g0123456789ab");
  assert.equal(manifest.dependencies.compiler.sourceSha.length, 40);
  assert.throws(() => assertStableDependencies({ dependencies: manifest.dependencies }), /require stable/u);
});

test("rejects a nested Language-Tools compiler-lock mismatch", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "web-release-"));
  const project = join(fixture, "web");
  const compiler = join(fixture, "compiler");
  const language = join(fixture, "language");
  await Promise.all([mkdir(join(project, "release"), { recursive: true }), mkdir(compiler), mkdir(join(language, "release"), { recursive: true })]);
  const compilerSha = "a".repeat(40);
  const languageSha = "b".repeat(40);
  await writeFile(join(project, "package.json"), JSON.stringify({ name: "interlis-web-ide", version: "0.1.0", dependencies: { "@ilic/tools": "0.10.0-snapshot.gaaaaaaaaaaaa", "@ilic/diagram": "0.1.2-snapshot.gbbbbbbbbbbbb", "@ilic/docx": "0.1.2-snapshot.gbbbbbbbbbbbb", "@ilic/language-service": "0.1.2-snapshot.gbbbbbbbbbbbb", "@ilic/monaco-adapter": "0.1.2-snapshot.gbbbbbbbbbbbb" } }));
  await writeFile(join(project, "release/dependencies.lock.json"), JSON.stringify({ schemaVersion: 1, project: "interlis-web-ide", artifactBaseVersion: "0.1.0", dependencies: { compiler: { version: "0.10.0-snapshot.gaaaaaaaaaaaa", sourceSha: compilerSha }, languageTools: { version: "0.1.2-snapshot.gbbbbbbbbbbbb", sourceSha: languageSha } } }));
  await writeFile(join(compiler, "CMakeLists.txt"), "project(ilic VERSION 0.10.0 LANGUAGES C CXX)\n");
  await writeFile(join(language, "package.json"), JSON.stringify({ name: "interlis-language-tools-workspace", version: "0.1.2" }));
  await writeFile(join(language, "release/dependencies.lock.json"), JSON.stringify({ dependencies: { "@ilic/compiler-wasm": { version: "0.10.0-snapshot.gcccccccccccc", sourceSha: "c".repeat(40) } } }));
  await assert.rejects(() => verifyUpstreams({ projectRoot: project, compilerRoot: compiler, languageToolsRoot: language, checkedCompilerSha: compilerSha, checkedLanguageToolsSha: languageSha }), /does not match/u);
});

test("deployment workflow has lock-only triggers", async () => {
  const workflow = await readFile(resolve(root, ".github/workflows/deploy-web-ide.yml"), "utf8");
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /tags:\s*\n\s*- "v\*"/u);
  assert.doesNotMatch(workflow, /repository_dispatch:|client_payload|SNAPSHOT_TIMESTAMP/u);
});

test("renders local tarball overrides for an explicit Language-Tools checkout", () => {
  const template = 'overrides:\n  "@ilic/tools": "file:../interlis-language-tools/artifacts/npm/ilic-tools.tgz"\n';
  assert.equal(
    renderLocalWorkspace(template, "/work/web", "/tmp/upstreams/language"),
    'overrides:\n  "@ilic/tools": "file:../../tmp/upstreams/language/artifacts/npm/ilic-tools.tgz"\n',
  );
});

test("preserves base workspace policy when rendering local overrides", () => {
  const template = 'allowBuilds:\n  esbuild: true\noverrides:\n  "@ilic/tools": "file:../interlis-language-tools/artifacts/npm/ilic-tools.tgz"\n';
  const base = "allowBuilds:\n  esbuild: true\nminimumReleaseAgeExclude:\n  - '@ilic/tools@0.10.0-snapshot.gaaaaaaaaaaa'\n";
  assert.equal(
    renderLocalWorkspace(template, "/work/web", "/tmp/upstreams/language", base),
    "allowBuilds:\n  esbuild: true\nminimumReleaseAgeExclude:\n  - '@ilic/tools@0.10.0-snapshot.gaaaaaaaaaaa'\noverrides:\n  \"@ilic/tools\": \"file:../../tmp/upstreams/language/artifacts/npm/ilic-tools.tgz\"\n",
  );
});
