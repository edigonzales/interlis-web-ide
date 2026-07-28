import { beforeEach, describe, expect, it } from "vitest";
import {
  defaultEditorSettings,
  editorSettingsKey,
  readEditorSettings,
  writeEditorSettings,
} from "../src/settings.js";

describe("editor settings", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      } satisfies Pick<Storage, "clear" | "getItem" | "setItem">,
    });
  });

  it("reads the versioned defaults", () => {
    expect(readEditorSettings()).toEqual(defaultEditorSettings);
  });

  it("bounds unsupported persisted values to defaults", () => {
    localStorage.setItem(
      editorSettingsKey,
      JSON.stringify({
        version: 1,
        fontSize: 20,
        formatOnType: "yes",
        rememberDiagramVisibility: false,
        autoSave: "always",
      }),
    );
    expect(readEditorSettings()).toEqual({
      ...defaultEditorSettings,
      rememberDiagramVisibility: false,
    });
  });

  it("falls back when the persisted settings version is unknown", () => {
    localStorage.setItem(editorSettingsKey, JSON.stringify({ version: 2 }));
    expect(readEditorSettings()).toEqual(defaultEditorSettings);
  });

  it("persists valid editor settings", () => {
    const settings = {
      ...defaultEditorSettings,
      fontSize: 16 as const,
      formatOnType: false,
      rememberDiagramVisibility: false,
      autoSave: "afterDelay" as const,
    };
    writeEditorSettings(settings);
    expect(readEditorSettings()).toEqual(settings);
  });
});
