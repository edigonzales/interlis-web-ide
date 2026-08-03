import { BufferRecoveryStore, type RecoveredBuffer } from "../workspace/recovery.js";
import type { WorkspaceFileSystem } from "../workspace/types.js";

export class RecoveryController {
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  #store: BufferRecoveryStore;
  #disposed = false;

  constructor(workspace: WorkspaceFileSystem, private readonly delayMs = 250) { this.#store = new BufferRecoveryStore(workspace); }
  attach(workspace: WorkspaceFileSystem): void { this.#clearAllTimers(); this.#store = new BufferRecoveryStore(workspace); }
  schedule(tab: { readonly path: string; readonly model: { getVersionId(): number; getValue(): string } }): void {
    this.clearTimer(tab.path);
    if (this.#disposed) return;
    this.#timers.set(tab.path, setTimeout(() => {
      this.#timers.delete(tab.path);
      void this.#store.save(tab.path, tab.model.getVersionId(), tab.model.getValue());
    }, this.delayMs));
  }
  restore(): Promise<readonly RecoveredBuffer[]> { return this.#store.list(); }
  list(): Promise<readonly RecoveredBuffer[]> { return this.#store.list(); }
  clear(path: string): Promise<void> { this.clearTimer(path); return this.#store.clear(path); }
  private clearTimer(path: string): void { const timer = this.#timers.get(path); if (timer) clearTimeout(timer); this.#timers.delete(path); }
  #clearAllTimers(): void { for (const path of [...this.#timers.keys()]) this.clearTimer(path); }
  dispose(): void { if (this.#disposed) return; this.#disposed = true; this.#clearAllTimers(); }
}
