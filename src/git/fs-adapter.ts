import type { FsClient } from "isomorphic-git";
import type { FileStat, WorkspaceFileSystem } from "../workspace/index.js";
import { normalizePath, textFile } from "../workspace/index.js";

type EncodingOption = string | { encoding?: string | null } | null | undefined;

class NodeLikeStat {
  readonly mode: number;
  readonly size: number;
  readonly ctimeMs: number;
  readonly mtimeMs: number;
  readonly uid = 0;
  readonly gid = 0;
  readonly dev = 0;
  readonly ino = 0;

  constructor(private readonly value: FileStat) {
    this.mode = value.type === "directory" ? 0o040755 : 0o100644;
    this.size = value.size;
    this.ctimeMs = value.ctime;
    this.mtimeMs = value.mtime;
  }

  isFile(): boolean {
    return this.value.type === "file";
  }
  isDirectory(): boolean {
    return this.value.type === "directory";
  }
  isSymbolicLink(): boolean {
    return false;
  }
}

class FileSystemError extends Error {
  constructor(
    readonly code: "EEXIST" | "EINVAL" | "ENOENT" | "ENOTDIR",
    message: string,
  ) {
    super(message);
    this.name = "FileSystemError";
  }
}

function wantsText(options: EncodingOption): boolean {
  const encoding = typeof options === "string" ? options : options?.encoding;
  return encoding === "utf8" || encoding === "utf-8";
}

function bytes(data: unknown): Uint8Array {
  if (typeof data === "string") return textFile(data);
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data))
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new FileSystemError("EINVAL", "Unsupported file content");
}

/** Node-style promise fs facade used by isomorphic-git. */
export class IsoGitFileSystemAdapter {
  readonly client: FsClient;

  constructor(private readonly workspace: WorkspaceFileSystem) {
    this.client = {
      promises: {
        readFile: (path: string, options?: EncodingOption) =>
          this.readFile(path, options),
        writeFile: (path: string, data: unknown) => this.writeFile(path, data),
        unlink: (path: string) => this.unlink(path),
        readdir: (path: string) => this.readdir(path),
        mkdir: (path: string) => this.mkdir(path),
        rmdir: (path: string) => this.rmdir(path),
        stat: (path: string) => this.stat(path),
        lstat: (path: string) => this.stat(path),
        readlink: () =>
          Promise.reject(
            new FileSystemError("EINVAL", "Symbolic links are not supported"),
          ),
        symlink: () =>
          Promise.reject(
            new FileSystemError("EINVAL", "Symbolic links are not supported"),
          ),
        chmod: () => Promise.resolve(),
      },
    };
  }

  private async readFile(
    path: string,
    options?: EncodingOption,
  ): Promise<Uint8Array | string> {
    try {
      const content = await this.workspace.read(normalizePath(path));
      return wantsText(options) ? new TextDecoder().decode(content) : content;
    } catch (error) {
      throw this.normalizeError(path, error);
    }
  }

  private async writeFile(path: string, data: unknown): Promise<void> {
    try {
      await this.workspace.write(normalizePath(path), bytes(data), {
        create: true,
        overwrite: true,
      });
    } catch (error) {
      throw this.normalizeError(path, error);
    }
  }

  private async unlink(path: string): Promise<void> {
    try {
      await this.workspace.delete(normalizePath(path));
    } catch (error) {
      throw this.normalizeError(path, error);
    }
  }

  private async readdir(path: string): Promise<string[]> {
    try {
      return (await this.workspace.readDirectory(normalizePath(path))).map(
        ([name]) => name,
      );
    } catch (error) {
      throw this.normalizeError(path, error);
    }
  }

  private async mkdir(path: string): Promise<void> {
    const normalized = normalizePath(path);
    try {
      const existing = await this.workspace.stat(normalized);
      if (existing.type === "directory") return;
      throw new FileSystemError("EEXIST", `File exists: ${path}`);
    } catch (error) {
      if (error instanceof FileSystemError) throw error;
      if (!this.isMissing(error)) throw this.normalizeError(path, error);
    }
    await this.workspace.createDirectory(normalized);
  }

  private async rmdir(path: string): Promise<void> {
    try {
      await this.workspace.delete(normalizePath(path));
    } catch (error) {
      throw this.normalizeError(path, error);
    }
  }

  private async stat(path: string): Promise<NodeLikeStat> {
    try {
      return new NodeLikeStat(await this.workspace.stat(normalizePath(path)));
    } catch (error) {
      throw this.normalizeError(path, error);
    }
  }

  private normalizeError(path: string, error: unknown): Error {
    if (error instanceof FileSystemError) return error;
    const message = error instanceof Error ? error.message : String(error);
    if (this.isMissing(error))
      return new FileSystemError("ENOENT", `No such file: ${path}`);
    if (message.includes("Not a directory"))
      return new FileSystemError("ENOTDIR", message);
    return error instanceof Error ? error : new Error(message);
  }

  private isMissing(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.name === "NotFoundError" ||
        error.message.includes("not found") ||
        error.message.includes("does not exist") ||
        error.message.includes("Path does not exist"))
    );
  }
}
