#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_TARBALL_ROOT = "../interlis-language-tools/artifacts/npm";

export function renderLocalWorkspace(template, webRoot, languageToolsRoot, baseWorkspace = null) {
  let tarballRoot = relative(
    resolve(webRoot),
    resolve(languageToolsRoot, "artifacts/npm"),
  )
    .split(sep)
    .join("/");
  if (!tarballRoot.startsWith(".")) tarballRoot = `./${tarballRoot}`;
  if (!template.includes(DEFAULT_TARBALL_ROOT)) {
    throw new Error("Local workspace template contains no Language-Tools tarball root");
  }
  const rendered = template.replaceAll(DEFAULT_TARBALL_ROOT, tarballRoot);
  if (baseWorkspace === null) return rendered;

  const overridesStart = rendered.search(/^overrides:\s*$/mu);
  if (overridesStart < 0) {
    throw new Error("Local workspace template contains no top-level overrides");
  }
  return `${baseWorkspace.trimEnd()}\n${rendered.slice(overridesStart).trim()}\n`;
}

async function main() {
  const [templatePath, outputPath, webRoot, languageToolsRoot] = process.argv.slice(2);
  if (!templatePath || !outputPath || !webRoot || !languageToolsRoot) {
    throw new Error("Expected template, output, Web root and Language-Tools root");
  }
  const template = await readFile(resolve(templatePath), "utf8");
  const baseWorkspace = await readFile(resolve(webRoot, "pnpm-workspace.yaml"), "utf8");
  await writeFile(
    resolve(outputPath),
    renderLocalWorkspace(template, webRoot, languageToolsRoot, baseWorkspace),
  );
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
