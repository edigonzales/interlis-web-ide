import { describe, expect, it, vi } from "vitest";
import { CommandRegistry } from "../src/workbench/command-registry.js";
import { TabController, type OpenTabView } from "../src/workbench/tab-controller.js";
import { WorkbenchView } from "../src/workbench/workbench-view.js";

describe("P7 workbench boundaries", () => {
  it("registers, executes and disposes commands by id", async () => {
    const registry = new CommandRegistry();
    const run = vi.fn();
    const disposable = registry.register({ id: "save", label: "Save", run });
    await registry.execute("save");
    expect(run).toHaveBeenCalledOnce();
    disposable.dispose();
    await expect(registry.execute("save")).rejects.toThrow("Unknown");
  });

  it("keeps tab ownership and active selection in one controller", () => {
    const tabs = new TabController<OpenTabView>();
    const first = { path: "/a.ili", label: "a", readOnly: false, model: {}, dirty: false };
    const second = { path: "/b.ili", label: "b", readOnly: false, model: {}, dirty: true };
    tabs.open(first);
    tabs.open(second);
    expect(tabs.active()).toBe(second);
    tabs.activate(first.path);
    expect(tabs.active()).toBe(first);
    expect(tabs.close(first.path)).toBe(first);
    expect(tabs.active()).toBe(second);
  });

  it("validates required view elements once and renders through the view", () => {
    const elements = new Map(["#output", "#problems", "#outline", "#result-status"].map((selector) => [selector, { textContent: "", replaceChildren: vi.fn() }]));
    const host = { querySelector: (selector: string) => elements.get(selector) } as unknown as HTMLElement;
    const view = new WorkbenchView(host);
    view.renderOutput("compile output");
    view.renderStatus("ready");
    expect(view.elements().output.textContent).toBe("compile output");
    expect(view.elements().resultStatus.textContent).toBe("ready");
    view.dispose();
    expect(view.elements().output.textContent).toBe("compile output");
  });
});
