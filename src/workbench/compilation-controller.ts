import type { CompilationEvent, CompilationTrigger, LanguageService } from "@ilic/language-service";

/** Owns compile triggers and the compilation-event subscription. */
export class CompilationController {
  readonly #subscription: { dispose(): void };
  constructor(private readonly service: LanguageService, private readonly onEvent: (event: CompilationEvent) => void) {
    this.#subscription = service.onCompilation(onEvent);
  }
  compile(uri: string, trigger: CompilationTrigger): Promise<CompilationEvent> { return this.service.compileDocument(uri, trigger); }
  dispose(): void { this.#subscription.dispose(); }
}
