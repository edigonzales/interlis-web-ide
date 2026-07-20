import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { WorkspaceFileSystem } from "./types.js";
import { normalizePath } from "./types.js";

async function collect(
  workspace: WorkspaceFileSystem,
  path: string,
  files: Record<string, Uint8Array>,
): Promise<void> {
  for (const [name, type] of await workspace.readDirectory(path)) {
    const child = normalizePath(`${path}/${name}`);
    if (type === "directory") await collect(workspace, child, files);
    else files[child.slice(1)] = await workspace.read(child);
  }
}

export async function exportWorkspaceZip(
  workspace: WorkspaceFileSystem,
): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  await collect(workspace, "/", files);
  if (Object.keys(files).length === 0)
    files["README.txt"] = strToU8("Empty INTERLIS workspace\n");
  return zipSync(files, { level: 6 });
}

export async function importWorkspaceZip(
  workspace: WorkspaceFileSystem,
  archive: Uint8Array,
  options: { overwrite?: boolean } = {},
): Promise<string[]> {
  const files = unzipSync(archive);
  const imported: string[] = [];
  for (const [name, content] of Object.entries(files)) {
    if (name.endsWith("/")) continue;
    const path = normalizePath(name);
    await workspace.write(path, content, {
      create: true,
      overwrite: options.overwrite ?? true,
    });
    imported.push(path);
  }
  return imported.sort();
}

export function downloadBytes(
  bytes: Uint8Array,
  filename: string,
  type: string,
): void {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function textFile(content: string): Uint8Array {
  return strToU8(content);
}
export function fileText(content: Uint8Array): string {
  return strFromU8(content);
}
