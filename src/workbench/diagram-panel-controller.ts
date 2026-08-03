import type { SemanticSnapshot } from "@ilic/language-service";
import { DiagramController, type LayoutDiagram, type AnchoredViewport } from "@ilic/diagram";

/** Owns last-good diagram state, layout, viewport, and invalidation. */
export class DiagramPanelController {
  readonly diagram = new DiagramController();
  #layout: LayoutDiagram | null = null;
  #viewport: AnchoredViewport | null = null;
  publish(snapshot: SemanticSnapshot, freshness: "fresh" | "stale"): void { this.diagram.publish(snapshot, freshness); }
  setLayout(layout: LayoutDiagram | null): void { this.#layout = layout; }
  layout(): LayoutDiagram | null { return this.#layout; }
  setViewport(viewport: AnchoredViewport | null): void { this.#viewport = viewport; }
  viewport(): AnchoredViewport | null { return this.#viewport; }
  dispose(): void { this.diagram.stale("Diagram controller disposed."); this.#layout = null; this.#viewport = null; }
}
