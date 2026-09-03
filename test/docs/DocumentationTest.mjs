import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(process.argv[2] ?? ".");
const retired = [
  "docs/build-und-publikationspipeline.md",
  "docs/architecture/p7-workbench.md",
  "release-train-published",
  "repository_dispatch",
  "SNAPSHOT_TIMESTAMP",
];

function markdownFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((name) => {
    if (["node_modules", "build", "dist", "playwright-report", "test-results"].includes(name)) return [];
    const path = join(directory, name);
    return statSync(path).isDirectory() ? markdownFiles(path) : path.endsWith(".md") ? [path] : [];
  });
}

const files = [join(root, "README.md"), ...markdownFiles(join(root, "docs"))];
for (const path of files) {
  const text = readFileSync(path, "utf8");
  assert.equal((text.match(/^```/gmu) ?? []).length % 2, 0, `${path}: offener Codeblock`);
  for (const name of retired) assert.ok(!text.includes(name), `${path}: veralteter Verweis ${name}`);
  const prose = text.replace(/^```[\s\S]*?^```/gmu, "");
  for (const match of prose.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
    let target = match[1].trim();
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
    if (!target || /^(?:https?:|mailto:)/u.test(target)) continue;
    const local = target.split("#", 1)[0];
    if (local) assert.ok(existsSync(resolve(dirname(path), decodeURIComponent(local))), `${path}: defekter Link ${target}`);
  }
}
const release = readFileSync(join(root, "docs/release.md"), "utf8");
assert.match(release, /0\.1\.0-snapshot\.g<web-sha>/u, "release.md: Web-Snapshot-Vertrag fehlt");
assert.doesNotMatch(release, /1\.0\.0-rc\.1|client_payload/u, "release.md: veralteter Releasevertrag");
console.log(`validated ${files.length} documentation pages`);
