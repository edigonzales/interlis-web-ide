import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { initialize } from "@codingame/monaco-vscode-api";
import getConfigurationServiceOverride, {
  getUserConfiguration,
  updateUserConfiguration,
} from "@codingame/monaco-vscode-configuration-service-override";
import getFilesServiceOverride from "@codingame/monaco-vscode-files-service-override";
import getKeybindingsServiceOverride from "@codingame/monaco-vscode-keybindings-service-override";
import getQuickAccessServiceOverride from "@codingame/monaco-vscode-quickaccess-service-override";
import getSearchServiceOverride from "@codingame/monaco-vscode-search-service-override";
import { readEditorSettings, type EditorSettings } from "./settings.js";

declare global {
  interface Window {
    MonacoEnvironment?: { getWorker(moduleId: string, label: string): Worker };
  }
}

let initialized: Promise<void> | null = null;

async function applyUserEditorSettings(
  settings: EditorSettings,
): Promise<void> {
  let existing: Record<string, unknown> = {};
  try {
    const stored = await getUserConfiguration();
    const parsed: unknown = JSON.parse(stored);
    if (parsed && typeof parsed === "object")
      existing = parsed as Record<string, unknown>;
  } catch {
    // The default settings file may not exist on the first startup.
  }
  await updateUserConfiguration(
    JSON.stringify({
      ...existing,
      "editor.fontLigatures": true,
      "editor.fontSize": settings.fontSize,
      "editor.formatOnType": settings.formatOnType,
      "editor.tabSize": 2,
      "editor.minimap.enabled": true,
      "files.autoSave": settings.autoSave,
      "files.autoSaveDelay": 1_000,
    }),
  );
}

export function updateVscodeEditorSettings(
  settings: EditorSettings,
): Promise<void> {
  return applyUserEditorSettings(settings);
}

export function initializeVscodeServices(
  container: HTMLElement,
): Promise<void> {
  if (initialized) return initialized;
  window.MonacoEnvironment = { getWorker: () => new editorWorker() };
  initialized = initialize(
    {
      ...getConfigurationServiceOverride(),
      ...getFilesServiceOverride(),
      ...getKeybindingsServiceOverride({
        shouldUseGlobalKeybindings: () => true,
      }),
      ...getQuickAccessServiceOverride({ shouldUseGlobalPicker: () => true }),
      ...getSearchServiceOverride(),
    },
    container,
  ).then(() => applyUserEditorSettings(readEditorSettings()));
  return initialized;
}

export { monaco };
