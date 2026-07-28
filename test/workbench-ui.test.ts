import { describe, expect, it } from "vitest";
import {
  clampSplitSize,
  defaultWorkbenchLayoutSettings,
  outlineCodiconName,
  parseWorkbenchLayoutSettings,
} from "../src/workbench/ui-state.js";

describe("workbench UI state", () => {
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
});
