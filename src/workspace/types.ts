export type FileType = "file" | "directory";

export interface FileStat {
  readonly type: FileType;
  readonly size: number;
  readonly ctime: number;
  readonly mtime: number;
}

export interface FileChange {
  readonly type: "created" | "changed" | "deleted";
  readonly path: string;
}

export interface Disposable {
  dispose(): void;
}

/** Binary filesystem boundary shared by workbench, compiler and Git adapters. */
export interface WorkspaceFileSystem {
  stat(path: string): Promise<FileStat>;
  read(path: string): Promise<Uint8Array>;
  write(
    path: string,
    content: Uint8Array,
    options?: { create?: boolean; overwrite?: boolean },
  ): Promise<void>;
  readDirectory(
    path: string,
  ): Promise<readonly [name: string, type: FileType][]>;
  createDirectory(path: string): Promise<void>;
  delete(path: string, options?: { recursive?: boolean }): Promise<void>;
  rename(
    from: string,
    to: string,
    options?: { overwrite?: boolean },
  ): Promise<void>;
  watch(
    path: string,
    listener: (changes: readonly FileChange[]) => void,
  ): Disposable;
}

export function normalizePath(path: string): string {
  const segments = path.replaceAll("\\", "/").split("/").filter(Boolean);
  if (segments.some((segment) => segment === ".."))
    throw new Error(`Path escapes workspace: ${path}`);
  return `/${segments.filter((segment) => segment !== ".").join("/")}`;
}

export function pathSegments(path: string): string[] {
  return normalizePath(path).split("/").filter(Boolean);
}

export function parentPath(path: string): string {
  const segments = pathSegments(path);
  segments.pop();
  return `/${segments.join("/")}`;
}

export function baseName(path: string): string {
  return pathSegments(path).at(-1) ?? "";
}
