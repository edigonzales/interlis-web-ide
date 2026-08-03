export interface LayoutSettingsStore<T> { read(): T; write(value: T): void; }

/** Owns persisted layout/theme settings and disposable UI subscriptions. */
export class LayoutController<T extends object> {
  #value: T;
  readonly #disposables = new Set<{ dispose(): void }>();
  constructor(private readonly store: LayoutSettingsStore<T>) { this.#value = store.read(); }
  get value(): T { return this.#value; }
  update(changes: Partial<T>): void { this.#value = { ...this.#value, ...changes }; this.store.write(this.#value); }
  add(disposable: { dispose(): void }): void { this.#disposables.add(disposable); }
  dispose(): void { for (const disposable of [...this.#disposables]) disposable.dispose(); this.#disposables.clear(); }
}
