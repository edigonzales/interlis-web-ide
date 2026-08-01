export interface WorkspaceSourceUpdate {
  readonly uri: string;
  readonly text: string;
  readonly version?: number;
}

export interface WorkspaceSourceSink {
  putWorkspaceSource(uri: string, text: string, version?: number): void;
  removeWorkspaceSource(uri: string): void;
}

interface SynchronizedSource {
  readonly text: string;
  readonly version: number;
}

/** Applies only file-level workspace changes to the language service. */
export class WorkspaceSourceSynchronizer {
  readonly #sources = new Map<string, SynchronizedSource>();
  #nextVersion = 0;

  constructor(private readonly sink: WorkspaceSourceSink) {}

  sync(sources: readonly WorkspaceSourceUpdate[]): void {
    const incoming = new Map<string, WorkspaceSourceUpdate>();
    for (const source of sources) incoming.set(source.uri, source);

    for (const uri of this.#sources.keys()) {
      if (!incoming.has(uri)) {
        this.sink.removeWorkspaceSource(uri);
        this.#sources.delete(uri);
      }
    }

    for (const source of incoming.values()) {
      const previous = this.#sources.get(source.uri);
      const version =
        source.version ??
        (previous && previous.text === source.text
          ? previous.version
          : ++this.#nextVersion);
      if (
        previous &&
        previous.text === source.text &&
        previous.version === version
      )
        continue;

      this.sink.putWorkspaceSource(source.uri, source.text, version);
      this.#nextVersion = Math.max(this.#nextVersion, version);
      this.#sources.set(source.uri, { text: source.text, version });
    }
  }

  clear(): void {
    for (const uri of this.#sources.keys())
      this.sink.removeWorkspaceSource(uri);
    this.#sources.clear();
  }
}
