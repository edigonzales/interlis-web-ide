import {
  FileSystemAccessWorkspace,
  PrefixWorkspaceFileSystem,
} from "./file-system-access.js";
import type { WorkspaceFileSystem } from "./types.js";

export async function openOpfsRoot(): Promise<FileSystemAccessWorkspace> {
  if (!navigator.storage?.getDirectory)
    throw new Error("OPFS is not available in this browser.");
  return new FileSystemAccessWorkspace(await navigator.storage.getDirectory());
}

export async function openOpfsWorkspace(
  id: string,
): Promise<WorkspaceFileSystem> {
  const root = await openOpfsRoot();
  await root.createDirectory(`/workspaces/${id}`);
  return new PrefixWorkspaceFileSystem(root, `/workspaces/${id}`);
}
