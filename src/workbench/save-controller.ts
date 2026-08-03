import type { WorkspaceFileSystem } from "../workspace/types.js";

export interface SaveTab {
  readonly path: string;
  readonly model: {
    getValue(): string;
    getVersionId(): number;
    uri: { toString(): string };
  };
  readonly readOnly: boolean;
  dirty: boolean;
}

export class SaveController {
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  #disposed = false;
  #workspace: WorkspaceFileSystem;

  constructor(
    workspace: WorkspaceFileSystem,
    private readonly synchronizer: { put(source: { uri: string; text: string; version: number }): void },
    private readonly onCompile?: (tab: SaveTab) => Promise<void>,
    private readonly onSaved?: (tab: SaveTab) => void,
  ) { this.#workspace = workspace; }

  attach(workspace: WorkspaceFileSystem): void { this.#workspace = workspace; }

  scheduleAutoSave(tab: SaveTab): void {
    this.cancelAutoSave(tab.path);
    if (this.#disposed || tab.readOnly) return;
    this.#timers.set(tab.path, setTimeout(() => { this.#timers.delete(tab.path); void this.save(tab, { compile: true }); }, 1_000));
  }

  cancelAutoSave(path: string): void { const timer = this.#timers.get(path); if (timer) clearTimeout(timer); this.#timers.delete(path); }
  cancelAll(): void { for (const path of [...this.#timers.keys()]) this.cancelAutoSave(path); }

  async save(tab: SaveTab, options: { readonly compile: boolean }): Promise<void> {
    if (this.#disposed || tab.readOnly) return;
    const text = tab.model.getValue();
    const version = tab.model.getVersionId();
    await this.#workspace.write(tab.path, new TextEncoder().encode(text), { create: true, overwrite: true });
    this.synchronizer.put({ uri: tab.path, text, version });
    tab.dirty = false;
    this.onSaved?.(tab);
    if (options.compile) await this.onCompile?.(tab);
  }

  async saveAll(tabs: readonly SaveTab[], options: { readonly compile?: boolean } = {}): Promise<void> {
    for (const tab of tabs) if (tab.dirty) await this.save(tab, { compile: options.compile ?? false });
  }

  dispose(): void { if (this.#disposed) return; this.#disposed = true; this.cancelAll(); }
}
