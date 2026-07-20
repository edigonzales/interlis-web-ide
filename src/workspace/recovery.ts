import type { WorkspaceFileSystem } from "./types.js";

export interface RecoveredBuffer {
  readonly uri: string;
  readonly version: number;
  readonly text: string;
  readonly savedAt: string;
}

export class BufferRecoveryStore {
  readonly #encoder = new TextEncoder();
  readonly #decoder = new TextDecoder();

  constructor(private readonly workspace: WorkspaceFileSystem) {}

  async save(uri: string, version: number, text: string): Promise<void> {
    const value: RecoveredBuffer = {
      uri,
      version,
      text,
      savedAt: new Date().toISOString(),
    };
    await this.workspace.write(
      this.#path(uri),
      this.#encoder.encode(JSON.stringify(value)),
      { create: true, overwrite: true },
    );
  }

  async restore(uri: string): Promise<RecoveredBuffer | null> {
    try {
      return JSON.parse(
        this.#decoder.decode(await this.workspace.read(this.#path(uri))),
      ) as RecoveredBuffer;
    } catch {
      return null;
    }
  }

  async list(): Promise<RecoveredBuffer[]> {
    try {
      const entries = await this.workspace.readDirectory("/.recovery");
      const buffers = await Promise.all(
        entries
          .filter(([, type]) => type === "file")
          .map(([name]) =>
            this.restore(decodeURIComponent(name.replace(/\.json$/, ""))),
          ),
      );
      return buffers
        .filter((buffer): buffer is RecoveredBuffer => buffer !== null)
        .sort((left, right) => right.savedAt.localeCompare(left.savedAt));
    } catch {
      return [];
    }
  }

  async clear(uri: string): Promise<void> {
    try {
      await this.workspace.delete(this.#path(uri));
    } catch {
      /* Missing recovery entries are already clear. */
    }
  }

  #path(uri: string): string {
    return `/.recovery/${encodeURIComponent(uri)}.json`;
  }
}
