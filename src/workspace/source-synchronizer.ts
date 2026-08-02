export interface WorkspaceSourceUpdate {
  readonly uri: string;
  readonly text: string;
  readonly version?: number;
}

export interface WorkspaceSourceSink {
  putWorkspaceSource(uri: string, text: string, version?: number): void;
  removeWorkspaceSource(uri: string): void;
}

export type WorkspaceFullSyncReason =
  | "startup"
  | "workspace-switch"
  | "reconnect"
  | "zip-import"
  | "git-operation"
  | "watcher-recovery"
  | "manual-refresh";

export interface WorkspaceSourceState extends WorkspaceSourceUpdate {
  readonly version: number;
}

export interface WorkspaceSynchronizationStats {
  readonly fullScans: number;
  readonly filesReadDuringFullScans: number;
  readonly directPuts: number;
  readonly directRemoves: number;
  readonly directRenames: number;
  readonly noOps: number;
}

export interface WorkspaceSyncResult {
  readonly changed: boolean;
  readonly added: readonly string[];
  readonly updated: readonly string[];
  readonly removed: readonly string[];
  readonly noOps: number;
}

interface SynchronizedSource {
  readonly text: string;
  readonly version: number;
}

/** Applies only file-level workspace changes to the language service. */
export class WorkspaceSourceSynchronizer {
  readonly #sources = new Map<string, SynchronizedSource>();
  #nextVersion = 0;
  #stats: WorkspaceSynchronizationStats = {
    fullScans: 0,
    filesReadDuringFullScans: 0,
    directPuts: 0,
    directRemoves: 0,
    directRenames: 0,
    noOps: 0,
  };

  constructor(private readonly sink: WorkspaceSourceSink) {}

  replaceAll(
    sources: readonly WorkspaceSourceUpdate[],
    reason: WorkspaceFullSyncReason,
  ): WorkspaceSyncResult {
    void reason;
    this.#stats = {
      ...this.#stats,
      fullScans: this.#stats.fullScans + 1,
      filesReadDuringFullScans:
        this.#stats.filesReadDuringFullScans + sources.length,
    };
    const incoming = new Map<string, WorkspaceSourceUpdate>();
    for (const source of sources) incoming.set(source.uri, source);
    const added: string[] = [];
    const updated: string[] = [];
    const removed: string[] = [];
    let noOps = 0;

    for (const uri of this.#sources.keys()) {
      if (!incoming.has(uri)) {
        this.sink.removeWorkspaceSource(uri);
        this.#sources.delete(uri);
        removed.push(uri);
      }
    }

    for (const source of incoming.values()) {
      const previous = this.#sources.get(source.uri);
      const version =
        source.version ??
        (previous && previous.text === source.text
          ? previous.version
          : ++this.#nextVersion);
      if (previous && previous.text === source.text && previous.version === version) {
        noOps += 1;
        continue;
      }

      this.sink.putWorkspaceSource(source.uri, source.text, version);
      this.#nextVersion = Math.max(this.#nextVersion, version);
      this.#sources.set(source.uri, { text: source.text, version });
      (previous ? updated : added).push(source.uri);
    }
    this.#stats = { ...this.#stats, noOps: this.#stats.noOps + noOps };
    return { changed: added.length + updated.length + removed.length > 0,
      added, updated, removed, noOps };
  }

  sync(sources: readonly WorkspaceSourceUpdate[]): WorkspaceSyncResult {
    return this.replaceAll(sources, "manual-refresh");
  }

  put(source: WorkspaceSourceUpdate): WorkspaceSyncResult {
    const previous = this.#sources.get(source.uri);
    const version = source.version ??
      (previous && previous.text === source.text ? previous.version : ++this.#nextVersion);
    if (previous && previous.text === source.text && previous.version === version) {
      this.#stats = { ...this.#stats, noOps: this.#stats.noOps + 1 };
      return { changed: false, added: [], updated: [], removed: [], noOps: 1 };
    }
    this.sink.putWorkspaceSource(source.uri, source.text, version);
    this.#nextVersion = Math.max(this.#nextVersion, version);
    this.#sources.set(source.uri, { text: source.text, version });
    this.#stats = { ...this.#stats, directPuts: this.#stats.directPuts + 1 };
    return { changed: true, added: previous ? [] : [source.uri],
      updated: previous ? [source.uri] : [], removed: [], noOps: 0 };
  }

  remove(uri: string): WorkspaceSyncResult {
    if (!this.#sources.has(uri)) {
      this.#stats = { ...this.#stats, noOps: this.#stats.noOps + 1 };
      return { changed: false, added: [], updated: [], removed: [], noOps: 1 };
    }
    this.sink.removeWorkspaceSource(uri);
    this.#sources.delete(uri);
    this.#stats = { ...this.#stats, directRemoves: this.#stats.directRemoves + 1 };
    return { changed: true, added: [], updated: [], removed: [uri], noOps: 0 };
  }

  rename(previousUri: string, next: WorkspaceSourceUpdate): WorkspaceSyncResult {
    const removed = this.remove(previousUri);
    const put = this.put(next);
    this.#stats = { ...this.#stats, directRenames: this.#stats.directRenames + 1 };
    return { changed: removed.changed || put.changed, added: put.added,
      updated: put.updated, removed: removed.removed, noOps: removed.noOps + put.noOps };
  }

  clear(): WorkspaceSyncResult {
    const removed = [...this.#sources.keys()];
    for (const uri of removed) this.sink.removeWorkspaceSource(uri);
    this.#sources.clear();
    return { changed: removed.length > 0, added: [], updated: [], removed, noOps: 0 };
  }

  snapshot(): readonly WorkspaceSourceState[] {
    return [...this.#sources.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([uri, source]) => ({ uri, text: source.text, version: source.version }));
  }

  metrics(): WorkspaceSynchronizationStats {
    return { ...this.#stats };
  }
}
