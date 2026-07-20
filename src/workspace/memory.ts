import type {
  Disposable,
  FileChange,
  FileStat,
  FileType,
  WorkspaceFileSystem,
} from "./types.js";
import { baseName, normalizePath, parentPath } from "./types.js";

interface Entry {
  readonly type: FileType;
  readonly content: Uint8Array;
  readonly ctime: number;
  readonly mtime: number;
}

export class MemoryWorkspaceFileSystem implements WorkspaceFileSystem {
  readonly #entries = new Map<string, Entry>();
  readonly #watchers = new Set<{
    path: string;
    listener: (changes: readonly FileChange[]) => void;
  }>();

  constructor() {
    const now = Date.now();
    this.#entries.set("/", {
      type: "directory",
      content: new Uint8Array(),
      ctime: now,
      mtime: now,
    });
  }

  stat(path: string): Promise<FileStat> {
    const entry = this.#entry(path);
    return Promise.resolve({
      type: entry.type,
      size: entry.content.length,
      ctime: entry.ctime,
      mtime: entry.mtime,
    });
  }

  read(path: string): Promise<Uint8Array> {
    const entry = this.#entry(path);
    if (entry.type !== "file")
      return Promise.reject(new Error(`Not a file: ${path}`));
    return Promise.resolve(entry.content.slice());
  }

  async write(
    path: string,
    content: Uint8Array,
    options: { create?: boolean; overwrite?: boolean } = {},
  ): Promise<void> {
    const key = normalizePath(path);
    const existing = this.#entries.get(key);
    if (!existing && options.create === false)
      throw new Error(`File does not exist: ${path}`);
    if (existing && options.overwrite === false)
      throw new Error(`File exists: ${path}`);
    await this.createDirectory(parentPath(key));
    const now = Date.now();
    this.#entries.set(key, {
      type: "file",
      content: content.slice(),
      ctime: existing?.ctime ?? now,
      mtime: now,
    });
    this.#emit(key, existing ? "changed" : "created");
  }

  readDirectory(
    path: string,
  ): Promise<readonly [name: string, type: FileType][]> {
    const key = normalizePath(path);
    if (this.#entry(key).type !== "directory")
      return Promise.reject(new Error(`Not a directory: ${path}`));
    const entries = [...this.#entries]
      .filter(
        ([candidate]) => candidate !== key && parentPath(candidate) === key,
      )
      .map(([candidate, entry]): [string, FileType] => [
        baseName(candidate),
        entry.type,
      ])
      .sort(([left], [right]) => left.localeCompare(right));
    return Promise.resolve(entries);
  }

  async createDirectory(path: string): Promise<void> {
    const key = normalizePath(path);
    if (this.#entries.has(key)) return;
    if (key !== "/") await this.createDirectory(parentPath(key));
    const now = Date.now();
    this.#entries.set(key, {
      type: "directory",
      content: new Uint8Array(),
      ctime: now,
      mtime: now,
    });
    this.#emit(key, "created");
  }

  delete(path: string, options: { recursive?: boolean } = {}): Promise<void> {
    const key = normalizePath(path);
    const descendants = [...this.#entries.keys()].filter((candidate) =>
      candidate.startsWith(`${key}/`),
    );
    if (descendants.length > 0 && !options.recursive)
      return Promise.reject(new Error(`Directory is not empty: ${path}`));
    this.#entries.delete(key);
    for (const descendant of descendants) this.#entries.delete(descendant);
    this.#emit(key, "deleted");
    return Promise.resolve();
  }

  async rename(
    from: string,
    to: string,
    options: { overwrite?: boolean } = {},
  ): Promise<void> {
    const source = normalizePath(from);
    const target = normalizePath(to);
    const existing = this.#entries.get(target);
    if (existing && !options.overwrite) throw new Error(`Target exists: ${to}`);
    if (existing) await this.delete(target, { recursive: true });
    const entries = [...this.#entries].filter(
      ([key]) => key === source || key.startsWith(`${source}/`),
    );
    if (entries.length === 0) throw new Error(`Path does not exist: ${from}`);
    await this.createDirectory(parentPath(target));
    for (const [key] of entries) this.#entries.delete(key);
    for (const [key, entry] of entries)
      this.#entries.set(`${target}${key.slice(source.length)}`, entry);
    this.#emit(source, "deleted");
    this.#emit(target, "created");
  }

  watch(
    path: string,
    listener: (changes: readonly FileChange[]) => void,
  ): Disposable {
    const watcher = { path: normalizePath(path), listener };
    this.#watchers.add(watcher);
    return { dispose: () => this.#watchers.delete(watcher) };
  }

  #entry(path: string): Entry {
    const entry = this.#entries.get(normalizePath(path));
    if (!entry) throw new Error(`Path does not exist: ${path}`);
    return entry;
  }

  #emit(path: string, type: FileChange["type"]): void {
    for (const watcher of this.#watchers)
      if (path === watcher.path || path.startsWith(`${watcher.path}/`))
        watcher.listener([{ path, type }]);
  }
}
