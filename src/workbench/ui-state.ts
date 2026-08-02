export interface WorkbenchLayoutSettings {
  readonly version: 1;
  readonly sidebarWidth: number;
  readonly auxiliaryRatio: number;
  readonly panelHeight: number;
  readonly diagramVisible: boolean;
}

export const defaultWorkbenchLayoutSettings: WorkbenchLayoutSettings = {
  version: 1,
  sidebarWidth: 260,
  auxiliaryRatio: 0.5,
  panelHeight: 180,
  diagramVisible: true,
};

export class DebouncedTask {
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly delayMs: number) {}

  schedule(task: () => void): void {
    this.cancel();
    this.#timer = setTimeout(() => {
      this.#timer = null;
      task();
    }, this.delayMs);
  }

  cancel(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }
}

export class SuggestionRequestGate {
  #generation = 0;

  next(): number {
    this.#generation += 1;
    return this.#generation;
  }

  invalidate(): number {
    this.#generation += 1;
    return this.#generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.#generation;
  }
}

export function updateDirtyState(
  state: { dirty: boolean },
  dirty: boolean,
): boolean {
  if (state.dirty === dirty) return false;
  state.dirty = dirty;
  return true;
}

function finiteNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

export function parseWorkbenchLayoutSettings(
  value: string | null,
): WorkbenchLayoutSettings {
  if (!value) return { ...defaultWorkbenchLayoutSettings };
  try {
    const parsed = JSON.parse(value) as Partial<WorkbenchLayoutSettings>;
    if (parsed.version !== 1) return { ...defaultWorkbenchLayoutSettings };
    return {
      version: 1,
      sidebarWidth: finiteNumber(
        parsed.sidebarWidth,
        defaultWorkbenchLayoutSettings.sidebarWidth,
        80,
        800,
      ),
      auxiliaryRatio: finiteNumber(
        parsed.auxiliaryRatio,
        defaultWorkbenchLayoutSettings.auxiliaryRatio,
        0.1,
        0.9,
      ),
      panelHeight: finiteNumber(
        parsed.panelHeight,
        defaultWorkbenchLayoutSettings.panelHeight,
        60,
        1_000,
      ),
      diagramVisible:
        typeof parsed.diagramVisible === "boolean"
          ? parsed.diagramVisible
          : defaultWorkbenchLayoutSettings.diagramVisible,
    };
  } catch {
    return { ...defaultWorkbenchLayoutSettings };
  }
}

export function clampSplitSize(
  value: number,
  available: number,
  selectedMinimum: number,
  adjacentMinimum: number,
): number {
  const safeAvailable = Math.max(0, available);
  const requestedMinimum = Math.max(0, selectedMinimum);
  const requestedAdjacentMinimum = Math.max(0, adjacentMinimum);
  const minimumTotal = requestedMinimum + requestedAdjacentMinimum;
  const scale =
    minimumTotal > 0 ? Math.min(1, safeAvailable / minimumTotal) : 1;
  const minimum = requestedMinimum * scale;
  const maximum = Math.max(
    minimum,
    safeAvailable - requestedAdjacentMinimum * scale,
  );
  const finite = Number.isFinite(value) ? value : minimum;
  return Math.min(maximum, Math.max(minimum, finite));
}

const outlineIconNames: Readonly<Record<string, string>> = {
  model: "symbol-module",
  module: "symbol-module",
  topic: "symbol-namespace",
  namespace: "symbol-namespace",
  class: "symbol-class",
  structure: "symbol-struct",
  association: "symbol-interface",
  interface: "symbol-interface",
  view: "symbol-object",
  graphic: "symbol-object",
  object: "symbol-object",
  attribute: "symbol-property",
  role: "symbol-property",
  property: "symbol-property",
  domain: "symbol-type-parameter",
  "type parameter": "symbol-type-parameter",
  typeparameter: "symbol-type-parameter",
  unit: "symbol-constant",
  constant: "symbol-constant",
  function: "symbol-function",
  constraint: "symbol-key",
  key: "symbol-key",
};

export function outlineCodiconName(kind: string): string {
  return outlineIconNames[kind.toLowerCase()] ?? "symbol-misc";
}
