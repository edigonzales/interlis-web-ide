import type { ProblemItem } from "./problem-model.js";

export class ProblemStore {
  readonly #byRoot = new Map<string, readonly ProblemItem[]>();

  replace(rootUri: string, values: readonly ProblemItem[]): void {
    this.#byRoot.set(rootUri, [...values]);
  }

  clear(): void {
    this.#byRoot.clear();
  }

  values(): ProblemItem[] {
    return [...this.#byRoot.values()].flatMap((values) => values);
  }
}
