#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_TARBALL_ROOT = "../interlis-language-tools/artifacts/npm";

export function renderLocalWorkspace(template, webRoot, languageToolsRoot) {
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
  return template.replaceAll(DEFAULT_TARBALL_ROOT, tarballRoot);
}

async function main() {
  const [templatePath, outputPath, webRoot, languageToolsRoot] = process.argv.slice(2);
  if (!templatePath || !outputPath || !webRoot || !languageToolsRoot) {
    throw new Error("Expected template, output, Web root and Language-Tools root");
  }
  const template = await readFile(resolve(templatePath), "utf8");
  await writeFile(
    resolve(outputPath),
    renderLocalWorkspace(template, webRoot, languageToolsRoot),
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
