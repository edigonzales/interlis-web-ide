export interface OpenTabView {
  readonly path: string;
  readonly label: string;
  readonly readOnly: boolean;
  readonly model: unknown;
  dirty: boolean;
}

export class TabController<T extends OpenTabView = OpenTabView> {
  readonly #tabs = new Map<string, T>();
  #activePath: string | null = null;

  open(tab: T): T { this.#tabs.set(tab.path, tab); this.#activePath = tab.path; return tab; }
  upsert(tab: T): T { this.#tabs.set(tab.path, tab); return tab; }
  close(path: string): T | null { const tab = this.#tabs.get(path) ?? null; this.#tabs.delete(path); if (this.#activePath === path) this.#activePath = this.#tabs.keys().next().value ?? null; return tab; }
  activate(path: string): void { if (!this.#tabs.has(path)) throw new Error(`Unknown tab: ${path}`); this.#activePath = path; }
  split(path?: string): void { if (path) this.activate(path); }
  tabs(): readonly T[] { return [...this.#tabs.values()]; }
  active(): T | null { return this.#activePath ? this.#tabs.get(this.#activePath) ?? null : null; }
  byPath(path: string): T | null { return this.#tabs.get(path) ?? null; }
  dispose(): void { this.#tabs.clear(); this.#activePath = null; }
}
