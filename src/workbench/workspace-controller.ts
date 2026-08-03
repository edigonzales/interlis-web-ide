import type { WorkspaceManager } from "../workspace/manager.js";
import type { WorkspaceFileSystem } from "../workspace/types.js";

/** Owns active filesystem selection and workspace synchronization boundaries. */
export class WorkspaceController {
  #workspace: WorkspaceFileSystem;
  readonly #listeners = new Set<(workspace: WorkspaceFileSystem) => void>();

  constructor(private readonly manager: WorkspaceManager) { this.#workspace = manager.activeFileSystem; }
  get active(): WorkspaceFileSystem { return this.#workspace; }
  async activate(id: string): Promise<void> { await this.manager.activate(id); this.#workspace = this.manager.activeFileSystem; this.#notify(); }
  attach(workspace: WorkspaceFileSystem): void { this.#workspace = workspace; this.#notify(); }
  onChanged(listener: (workspace: WorkspaceFileSystem) => void): { dispose(): void } { this.#listeners.add(listener); return { dispose: () => this.#listeners.delete(listener) }; }
  #notify(): void { for (const listener of [...this.#listeners]) listener(this.#workspace); }
  dispose(): void { this.#listeners.clear(); }
}
