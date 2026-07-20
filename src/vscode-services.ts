import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { initialize } from "@codingame/monaco-vscode-api";
import getConfigurationServiceOverride, {
  updateUserConfiguration,
} from "@codingame/monaco-vscode-configuration-service-override";
import getFilesServiceOverride from "@codingame/monaco-vscode-files-service-override";
import getKeybindingsServiceOverride from "@codingame/monaco-vscode-keybindings-service-override";
import getQuickAccessServiceOverride from "@codingame/monaco-vscode-quickaccess-service-override";
import getSearchServiceOverride from "@codingame/monaco-vscode-search-service-override";

declare global {
  interface Window {
    MonacoEnvironment?: { getWorker(moduleId: string, label: string): Worker };
  }
}

let initialized: Promise<void> | null = null;

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
  ).then(async () => {
    await updateUserConfiguration(
      JSON.stringify({
        "editor.fontLigatures": true,
        "editor.formatOnType": true,
        "editor.minimap.enabled": true,
        "files.autoSave": "off",
      }),
    );
  });
  return initialized;
}

export { monaco };
