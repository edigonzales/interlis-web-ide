import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampSplitSize,
  DebouncedTask,
  defaultWorkbenchLayoutSettings,
  outlineCodiconName,
  parseWorkbenchLayoutSettings,
  SuggestionRequestGate,
  updateDirtyState,
} from "../src/workbench/ui-state.js";

describe("workbench UI state", () => {
  afterEach(() => vi.useRealTimers());

  it("parses and bounds versioned layout settings", () => {
    expect(
      parseWorkbenchLayoutSettings(
        JSON.stringify({
          version: 1,
          sidebarWidth: 999,
          auxiliaryRatio: -1,
          panelHeight: 20,
          diagramVisible: false,
        }),
      ),
    ).toEqual({
      version: 1,
      sidebarWidth: 800,
      auxiliaryRatio: 0.1,
      panelHeight: 60,
      diagramVisible: false,
    });
  });

  it("falls back for invalid or unknown settings", () => {
    expect(parseWorkbenchLayoutSettings("{")).toEqual(
      defaultWorkbenchLayoutSettings,
    );
    expect(
      parseWorkbenchLayoutSettings(JSON.stringify({ version: 2 })),
    ).toEqual(defaultWorkbenchLayoutSettings);
  });

  it("reduces pane minimums proportionally in narrow containers", () => {
    expect(clampSplitSize(20, 1_000, 180, 400)).toBe(180);
    expect(clampSplitSize(900, 1_000, 180, 400)).toBe(600);
    expect(clampSplitSize(200, 290, 180, 400)).toBe(90);
  });

  it("maps INTERLIS outline kinds to Codicons", () => {
    expect(outlineCodiconName("MODEL")).toBe("symbol-module");
    expect(outlineCodiconName("attribute")).toBe("symbol-property");
    expect(outlineCodiconName("association")).toBe("symbol-interface");
    expect(outlineCodiconName("constant")).toBe("symbol-constant");
    expect(outlineCodiconName("interface")).toBe("symbol-interface");
    expect(outlineCodiconName("unknown")).toBe("symbol-misc");
  });

  it("runs only the latest suggestion and outline task in an edit burst", () => {
    vi.useFakeTimers();
    const suggestions = vi.fn();
    const outlines = vi.fn();
    const suggestionTask = new DebouncedTask(75);
    const outlineTask = new DebouncedTask(150);

    for (let index = 0; index < 100; index += 1) {
      suggestionTask.schedule(() => {
        suggestions(index);
      });
      outlineTask.schedule(() => {
        outlines(index);
      });
    }
    vi.advanceTimersByTime(74);
    expect(suggestions).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(suggestions).toHaveBeenCalledOnce();
    expect(suggestions).toHaveBeenCalledWith(99);
    vi.advanceTimersByTime(75);
    expect(outlines).toHaveBeenCalledOnce();
    expect(outlines).toHaveBeenCalledWith(99);
  });

  it("invalidates stale suggestion requests", () => {
    const gate = new SuggestionRequestGate();
    const first = gate.next();
    expect(gate.isCurrent(first)).toBe(true);

    const second = gate.next();
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);

    gate.invalidate();
    expect(gate.isCurrent(second)).toBe(false);
  });

  it("cancels deferred work and renders dirty state only on transitions", () => {
    vi.useFakeTimers();
    const task = new DebouncedTask(75);
    const deferred = vi.fn();
    task.schedule(deferred);
    task.cancel();
    vi.runAllTimers();
    expect(deferred).not.toHaveBeenCalled();

    const tab = { dirty: false };
    const renders = vi.fn();
    for (let index = 0; index < 100; index += 1)
      if (updateDirtyState(tab, true)) renders();
    expect(renders).toHaveBeenCalledOnce();
    expect(updateDirtyState(tab, false)).toBe(true);
    expect(updateDirtyState(tab, false)).toBe(false);
  });
});
