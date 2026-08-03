import type { DiagnosticsChangedEvent } from "@ilic/language-service";
import { ProblemStore } from "../problems/problem-store.js";
import { projectProblems } from "../problems/problem-projector.js";

export class ProblemsController {
  readonly #render: () => void;
  constructor(private readonly store = new ProblemStore(), render: () => void = () => undefined) { this.#render = render; }
  setDiagnostics(event: DiagnosticsChangedEvent & { readonly diagnostics?: readonly unknown[]; readonly rootUri?: string }): void {
    if (event.diagnostics && event.rootUri) this.store.replace(event.rootUri, projectProblems(event.diagnostics as never, event.rootUri));
    this.#render();
  }
  clearUri(uri: string): void { void uri; this.#render(); }
  clearAll(): void { this.store.clear(); this.#render(); }
  render(): void { this.#render(); }
  navigate(problemId: string): Promise<void> { void problemId; return Promise.resolve(); }
  navigateRelated(problemId: string, relatedIndex: number): Promise<void> { void problemId; void relatedIndex; return Promise.resolve(); }
  dispose(): void { this.store.clear(); }
}
