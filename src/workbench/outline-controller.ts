import type { DocumentSymbol } from "@ilic/language-service";

/** Owns outline data and collapse state independently from DOM rendering. */
export class OutlineController {
  readonly #collapsed = new Set<string>();
  #symbols: readonly DocumentSymbol[] = [];
  setSymbols(symbols: readonly DocumentSymbol[]): void { this.#symbols = symbols; }
  symbols(): readonly DocumentSymbol[] { return this.#symbols; }
  toggle(id: string): void { if (this.#collapsed.has(id)) this.#collapsed.delete(id); else this.#collapsed.add(id); }
  isCollapsed(id: string): boolean { return this.#collapsed.has(id); }
  clear(): void { this.#symbols = []; this.#collapsed.clear(); }
  dispose(): void { this.clear(); }
}
