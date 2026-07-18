import type { WorkspaceFileSystem } from "./types.js";

export function repositoryDirectories(
  value: string,
  workspacePath = "/",
  bundledPath = "/.interlis/standard-models",
): string[] {
  return value
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) =>
      entry
        .replaceAll("%ILI_DIR", workspacePath)
        .replaceAll("%JAR_DIR", bundledPath),
    );
}

export class RepositoryModelCache {
  readonly #encoder = new TextEncoder();
  readonly #decoder = new TextDecoder();
  constructor(private readonly workspace: WorkspaceFileSystem) {}

  async put(repository: string, model: string, source: string): Promise<void> {
    await this.workspace.write(
      this.#path(repository, model),
      this.#encoder.encode(source),
      { create: true, overwrite: true },
    );
  }

  async get(repository: string, model: string): Promise<string | null> {
    try {
      return this.#decoder.decode(
        await this.workspace.read(this.#path(repository, model)),
      );
    } catch {
      return null;
    }
  }

  #path(repository: string, model: string): string {
    const key = [...this.#encoder.encode(repository)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    return `/.interlis/model-cache/${key}/${model}.ili`;
  }
}
