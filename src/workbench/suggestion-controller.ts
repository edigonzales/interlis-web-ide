import { DebouncedTask, SuggestionRequestGate } from "./ui-state.js";

/** Owns Monaco suggestion debounce and stale-request gates. */
export class SuggestionController {
  readonly #refresh: DebouncedTask;
  readonly #requests = new SuggestionRequestGate();
  constructor(delayMs: number, private readonly run: (generation: number) => void) { this.#refresh = new DebouncedTask(delayMs); }
  schedule(): void { const generation = this.#requests.next(); this.#refresh.schedule(() => this.run(generation)); }
  invalidate(): void { this.#requests.invalidate(); this.#refresh.cancel(); }
  current(generation: number): boolean { return this.#requests.isCurrent(generation); }
  dispose(): void { this.invalidate(); }
}
