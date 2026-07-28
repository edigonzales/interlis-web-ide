export const editorSettingsKey = "interlis-web-ide.editor-settings";

export const editorFontSizes = [12, 14, 16] as const;
export type EditorFontSize = (typeof editorFontSizes)[number];
export type AutoSaveMode = "off" | "afterDelay";

export interface EditorSettings {
  readonly version: 1;
  readonly fontSize: EditorFontSize;
  readonly formatOnType: boolean;
  readonly rememberDiagramVisibility: boolean;
  readonly autoSave: AutoSaveMode;
}

export const defaultEditorSettings: EditorSettings = {
  version: 1,
  fontSize: 14,
  formatOnType: true,
  rememberDiagramVisibility: true,
  autoSave: "off",
};

function isEditorFontSize(value: unknown): value is EditorFontSize {
  return (
    typeof value === "number" &&
    (editorFontSizes as readonly number[]).includes(value)
  );
}

export function readEditorSettings(): EditorSettings {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(editorSettingsKey) ?? "{}",
    ) as Partial<EditorSettings>;
    if (parsed.version !== undefined && parsed.version !== 1)
      return { ...defaultEditorSettings };
    return {
      version: 1,
      fontSize: isEditorFontSize(parsed.fontSize)
        ? parsed.fontSize
        : defaultEditorSettings.fontSize,
      formatOnType:
        typeof parsed.formatOnType === "boolean"
          ? parsed.formatOnType
          : defaultEditorSettings.formatOnType,
      rememberDiagramVisibility:
        typeof parsed.rememberDiagramVisibility === "boolean"
          ? parsed.rememberDiagramVisibility
          : defaultEditorSettings.rememberDiagramVisibility,
      autoSave:
        parsed.autoSave === "afterDelay" || parsed.autoSave === "off"
          ? parsed.autoSave
          : defaultEditorSettings.autoSave,
    };
  } catch {
    return { ...defaultEditorSettings };
  }
}

export function writeEditorSettings(settings: EditorSettings): void {
  localStorage.setItem(editorSettingsKey, JSON.stringify(settings));
}
