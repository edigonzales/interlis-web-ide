import type {
  Disposable,
  FileChange,
  FileStat,
  FileType,
  WorkspaceFileSystem,
} from "./types.js";
import { baseName, normalizePath, parentPath, pathSegments } from "./types.js";

interface IterableDirectoryHandle extends FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
}

export class FileSystemAccessWorkspace implements WorkspaceFileSystem {
  readonly #watchers = new Set<{
    path: string;
    listener: (changes: readonly FileChange[]) => void;
  }>();

  constructor(readonly root: FileSystemDirectoryHandle) {}

  async stat(path: string): Promise<FileStat> {
    const handle = await this.#handle(path);
    if (handle.kind === "directory")
      return { type: "directory", size: 0, ctime: 0, mtime: 0 };
    const file = await (handle as FileSystemFileHandle).getFile();
    return {
      type: "file",
      size: file.size,
      ctime: file.lastModified,
      mtime: file.lastModified,
    };
  }

  async read(path: string): Promise<Uint8Array> {
    const handle = await this.#file(path, false);
    return new Uint8Array(await (await handle.getFile()).arrayBuffer());
  }

  async write(
    path: string,
    content: Uint8Array,
    options: { create?: boolean; overwrite?: boolean } = {},
  ): Promise<void> {
    const existed = await this.#exists(path);
    if (!existed && options.create === false)
      throw new Error(`File does not exist: ${path}`);
    if (existed && options.overwrite === false)
      throw new Error(`File exists: ${path}`);
    const handle = await this.#file(path, true);
    const writable = await handle.createWritable();
    await writable.write(content as Uint8Array<ArrayBuffer>);
    await writable.close();
    this.#emit(path, existed ? "changed" : "created");
  }

  async readDirectory(
    path: string,
  ): Promise<readonly [name: string, type: FileType][]> {
    const directory = await this.#directory(path, false);
    const result: [string, FileType][] = [];
    for await (const [name, handle] of (
      directory as IterableDirectoryHandle
    ).entries())
      result.push([name, handle.kind]);
    return result.sort(([left], [right]) => left.localeCompare(right));
  }

  async createDirectory(path: string): Promise<void> {
    await this.#directory(path, true);
  }

  async delete(
    path: string,
    options: { recursive?: boolean } = {},
  ): Promise<void> {
    const parent = await this.#directory(parentPath(path), false);
    await parent.removeEntry(baseName(path), {
      recursive: options.recursive ?? false,
    });
    this.#emit(path, "deleted");
  }

  async rename(
    from: string,
    to: string,
    options: { overwrite?: boolean } = {},
  ): Promise<void> {
    const source = await this.stat(from);
    if (await this.#exists(to)) {
      if (!options.overwrite) throw new Error(`Target exists: ${to}`);
      await this.delete(to, { recursive: true });
    }
    if (source.type === "file") await this.write(to, await this.read(from));
    else await this.#copyDirectory(from, to);
    await this.delete(from, { recursive: true });
    this.#emit(to, "created");
  }

  watch(
    path: string,
    listener: (changes: readonly FileChange[]) => void,
  ): Disposable {
    const watcher = { path: normalizePath(path), listener };
    this.#watchers.add(watcher);
    return { dispose: () => this.#watchers.delete(watcher) };
  }

  async #directory(
    path: string,
    create: boolean,
  ): Promise<FileSystemDirectoryHandle> {
    let current = this.root;
    for (const segment of pathSegments(path))
      current = await current.getDirectoryHandle(segment, { create });
    return current;
  }

  async #file(path: string, create: boolean): Promise<FileSystemFileHandle> {
    const parent = await this.#directory(parentPath(path), create);
    return parent.getFileHandle(baseName(path), { create });
  }

  async #handle(path: string): Promise<FileSystemHandle> {
    const key = normalizePath(path);
    if (key === "/") return this.root;
    const parent = await this.#directory(parentPath(key), false);
    try {
      return await parent.getFileHandle(baseName(key));
    } catch {
      return parent.getDirectoryHandle(baseName(key));
    }
  }

  async #exists(path: string): Promise<boolean> {
    try {
      await this.#handle(path);
      return true;
    } catch {
      return false;
    }
  }

  async #copyDirectory(from: string, to: string): Promise<void> {
    await this.createDirectory(to);
    for (const [name, type] of await this.readDirectory(from)) {
      const source = `${normalizePath(from)}/${name}`;
      const target = `${normalizePath(to)}/${name}`;
      if (type === "directory") await this.#copyDirectory(source, target);
      else await this.write(target, await this.read(source));
    }
  }

  #emit(path: string, type: FileChange["type"]): void {
    const key = normalizePath(path);
    for (const watcher of this.#watchers)
      if (key === watcher.path || key.startsWith(`${watcher.path}/`))
        watcher.listener([{ path: key, type }]);
  }
}

export class PrefixWorkspaceFileSystem implements WorkspaceFileSystem {
  readonly #prefix: string;
  constructor(
    private readonly delegate: WorkspaceFileSystem,
    prefix: string,
  ) {
    this.#prefix = normalizePath(prefix);
  }
  #path(path: string): string {
    return normalizePath(`${this.#prefix}/${normalizePath(path)}`);
  }
  stat(path: string) {
    return this.delegate.stat(this.#path(path));
  }
  read(path: string) {
    return this.delegate.read(this.#path(path));
  }
  write(
    path: string,
    content: Uint8Array,
    options?: { create?: boolean; overwrite?: boolean },
  ) {
    return this.delegate.write(this.#path(path), content, options);
  }
  readDirectory(path: string) {
    return this.delegate.readDirectory(this.#path(path));
  }
  createDirectory(path: string) {
    return this.delegate.createDirectory(this.#path(path));
  }
  delete(path: string, options?: { recursive?: boolean }) {
    return this.delegate.delete(this.#path(path), options);
  }
  rename(from: string, to: string, options?: { overwrite?: boolean }) {
    return this.delegate.rename(this.#path(from), this.#path(to), options);
  }
  watch(path: string, listener: (changes: readonly FileChange[]) => void) {
    return this.delegate.watch(this.#path(path), (changes) =>
      listener(
        changes.map((change) => ({
          ...change,
          path: change.path.slice(this.#prefix.length) || "/",
        })),
      ),
    );
  }
}
