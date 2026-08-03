import type { editor } from "monaco-editor";
import {
  DiagramController,
  captureViewport,
  defaultDiagramSettings,
  layoutAndRenderDiagram,
  restoreViewport,
  sourceLocationForNode,
  type AnchoredViewport,
  type DiagramSettings,
  type LayoutDiagram,
  type Viewport,
} from "@ilic/diagram";
import { generateDocx } from "@ilic/docx";
import {
  fetchTemplate,
  formatCompilationOutputForDisplay,
  type CompilationEvent,
  type Diagnostic,
  type DocumentSymbol,
  type LanguageService,
} from "@ilic/language-service";
import type {
  Disposable as LanguageDisposable,
  MonacoLanguageAdapter,
} from "@ilic/monaco-adapter";
import { monaco, updateVscodeEditorSettings } from "../vscode-services.js";
import {
  createBrowserModelRepository,
  repositoryEntryLabel,
  repositorySettingEntries,
  readRepositorySetting,
  repositorySettingsKey,
  serializeRepositorySetting,
} from "../language-repository.js";
import {
  DirectoryHandleStore,
  LocalFolderWorkspace,
  WorkspaceManager,
  downloadBytes,
  exportWorkspaceZip,
  fileText,
  importWorkspaceZip,
  normalizePath,
  textFile,
  WorkspaceSourceSynchronizer,
} from "../workspace/index.js";
import type {
  WorkspaceDescriptor,
  WorkspaceFullSyncReason,
  WorkspaceFileSystem,
} from "../workspace/index.js";
import { workbenchTemplate } from "./template.js";
import {
  clampSplitSize,
  DebouncedTask,
  defaultWorkbenchLayoutSettings,
  outlineCodiconName,
  parseWorkbenchLayoutSettings,
  SuggestionRequestGate,
  updateDirtyState,
  type WorkbenchLayoutSettings,
} from "./ui-state.js";
import {
  editorFontSizes,
  readEditorSettings,
  writeEditorSettings,
  type EditorSettings,
} from "../settings.js";
import { ProblemStore } from "../problems/problem-store.js";
import { projectProblems } from "../problems/problem-projector.js";
import { problemSelection } from "../problems/problem-navigation.js";
import type { ProblemItem } from "../problems/problem-model.js";
import { CommandRegistry } from "./command-registry.js";
import { TabController } from "./tab-controller.js";
import { SaveController } from "./save-controller.js";
import { RecoveryController } from "./recovery-controller.js";

interface OpenTab {
  readonly path: string;
  readonly label: string;
  readonly model: editor.ITextModel;
  readonly readOnly: boolean;
  dirty: boolean;
  readonly language: LanguageDisposable;
}

interface Command {
  readonly id: string;
  readonly label: string;
  readonly run: () => void | Promise<void>;
}

const sampleModel = `INTERLIS 2.4;
MODEL NewModel AT "https://example.invalid/models" VERSION "1" =
  TOPIC Catalog =
    CLASS Item =
      Name : TEXT*80;
    END Item;
  END Catalog;
END NewModel.
`;

const diagramSettingsKey = "interlis-web-ide.diagram-settings";
const layoutSettingsKey = "interlis-web-ide.layout-settings";
const suggestionDelay = 200;
const outlineDelay = 150;
const minDiagramZoom = 0.25;
const maxDiagramZoom = 3;
const diagramZoomFactor = 1.1;
const diagramPadding = 12;
const hiddenEditorScrollbars: editor.IEditorScrollbarOptions = {
  vertical: "hidden",
  horizontal: "hidden",
};

function clampDiagramZoom(value: number): number {
  return Math.min(maxDiagramZoom, Math.max(minDiagramZoom, value));
}

function readDiagramSettings(): DiagramSettings {
  try {
    const stored = JSON.parse(
      localStorage.getItem(diagramSettingsKey) ?? "{}",
    ) as Partial<DiagramSettings>;
    return { ...defaultDiagramSettings, ...stored };
  } catch {
    return defaultDiagramSettings;
  }
}

export class WebIdeWorkbench {
  readonly #tabController = new TabController<OpenTab>();
  readonly #handleStore = new DirectoryHandleStore();
  readonly #commandRegistry = new CommandRegistry();
  readonly #workspaceListeners = new Set<() => void>();
  readonly #diagram = new DiagramController();
  readonly #workspaceSourceSynchronizer: WorkspaceSourceSynchronizer;
  readonly #problemStore = new ProblemStore();
  readonly #outlineCollapsed = new Set<string>();
  readonly #suggestionRefresh = new DebouncedTask(suggestionDelay);
  readonly #suggestionRequests = new SuggestionRequestGate();
  readonly #outlineRefresh = new DebouncedTask(outlineDelay);
  readonly #outlineEntries = new Map<
    string,
    {
      readonly symbol: DocumentSymbol;
      readonly depth: number;
      row: HTMLElement;
    }
  >();
  #workspace: WorkspaceFileSystem;
  readonly #saveController: SaveController;
  readonly #recoveryController: RecoveryController;
  #layout: WorkbenchLayoutSettings = parseWorkbenchLayoutSettings(
    localStorage.getItem(layoutSettingsKey),
  );
  #editorSettings: EditorSettings = readEditorSettings();
  #primary!: editor.IStandaloneCodeEditor;
  #secondary: editor.IStandaloneCodeEditor | null = null;
  #activePath: string | null = null;
  #activeView = "explorer";
  #openEditorsCollapsed = false;
  #sidebarGeneration = 0;
  #outlineGeneration = 0;
  #diagramGeneration = 0;
  #diagramLayout: LayoutDiagram | null = null;
  #diagramViewport: AnchoredViewport | null = null;
  #diagramSvg = "";
  #diagramInteractionController: AbortController | null = null;
  #diagramVisible = this.#editorSettings.rememberDiagramVisibility
    ? this.#layout.diagramVisible
    : defaultWorkbenchLayoutSettings.diagramVisible;
  #diagramPreferredVisible = this.#diagramVisible;
  #diagramSettings = readDiagramSettings();
  #sourceControlRenderer: (() => HTMLElement | Promise<HTMLElement>) | null =
    null;
  #dragDepth = 0;
  #disposed = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly manager: WorkspaceManager,
    private readonly languageService: LanguageService,
    private readonly languageAdapter: MonacoLanguageAdapter,
  ) {
    this.#workspace = manager.activeFileSystem;
    this.#workspaceSourceSynchronizer = new WorkspaceSourceSynchronizer(
      languageService,
    );
    this.#recoveryController = new RecoveryController(this.#workspace, 250);
    this.#saveController = new SaveController(
      this.#workspace,
      this.#workspaceSourceSynchronizer,
      async (tab) => {
        await this.languageService.compileDocument(tab.model.uri.toString(), "save");
      },
      (tab) => {
        this.languageService.markSaved(tab.model.uri.toString());
        // Auto-save must publish the clean tab state before the compile-after-save
        // workflow finishes; compilation is intentionally allowed to run longer.
        this.#renderTabs();
        void this.renderSidebar();
      },
    );
    const commands: Command[] = [
      {
        id: "new-file",
        label: "File: New INTERLIS Model",
        run: () => this.newFile(),
      },
      {
        id: "new-from-template",
        label: "INTERLIS: New Model from Remote Template",
        run: () => this.newFromRemoteTemplate(),
      },
      { id: "save", label: "File: Save", run: () => this.saveActive() },
      {
        id: "close-editor",
        label: "File: Close Editor",
        run: () => this.closeActiveEditor(),
      },
      {
        id: "open-folder",
        label: "File: Open Local Folder…",
        run: () => this.openLocalFolder(),
      },
      {
        id: "import-zip",
        label: "Workspace: Import ZIP…",
        run: () => this.pickZip(),
      },
      {
        id: "export-zip",
        label: "Workspace: Export ZIP",
        run: () => this.exportZip(),
      },
      {
        id: "new-workspace",
        label: "Workspace: New Named Workspace",
        run: () => this.newWorkspace(),
      },
      {
        id: "rename-workspace",
        label: "Workspace: Rename Current Workspace…",
        run: () => this.renameWorkspace(),
      },
      {
        id: "delete-workspace",
        label: "Workspace: Delete Current Workspace…",
        run: () => this.deleteWorkspace(),
      },
      {
        id: "split",
        label: "View: Split Editor",
        run: () => this.toggleSplit(),
      },
      {
        id: "toggle-panel",
        label: "View: Toggle Panel",
        run: () => this.togglePanel(),
      },
      {
        id: "compile",
        label: "INTERLIS: Compile Model",
        run: () => this.compileWorkspace(),
      },
      {
        id: "diagram",
        label: "View: Toggle Live Diagram",
        run: () => this.toggleDiagram(),
      },
      {
        id: "diagram-refresh",
        label: "INTERLIS: Refresh Diagram / Auto-layout",
        run: () => this.showDiagram(true),
      },
      {
        id: "export-svg",
        label: "INTERLIS: Export Diagram as SVG",
        run: () => this.exportSvg(),
      },
      {
        id: "export-docx",
        label: "INTERLIS: Export Documentation as DOCX",
        run: () => this.exportDocx(),
      },
      {
        id: "theme",
        label: "Preferences: Toggle Color Theme",
        run: () => this.toggleTheme(),
      },
      {
        id: "refresh",
        label: "Explorer: Refresh",
        run: () => this.renderSidebar(),
      },
      {
        id: "outline-collapse-all",
        label: "Outline: Collapse All",
        run: () => this.#collapseOutline(),
      },
    ];
    for (const command of commands) this.#commandRegistry.register(command);
  }

  async initialize(): Promise<void> {
    this.host.innerHTML = workbenchTemplate;
    this.#applyLayoutSettings();
    this.#configureInterlis();
    const editorHost = this.#required<HTMLElement>("#editor-primary");
    this.#primary = monaco.editor.create(editorHost, {
      automaticLayout: true,
      theme: "interlis-dark",
      fontSize: this.#editorSettings.fontSize,
      formatOnType: this.#editorSettings.formatOnType,
      lineHeight: 21,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      scrollbar: hiddenEditorScrollbars,
      glyphMargin: true,
      tabSize: 2,
    });
    this.#registerSnippetNavigation();
    this.#primary.onDidChangeCursorPosition((event) => {
      this.#required("#cursor-status").textContent =
        `Ln ${event.position.lineNumber}, Col ${event.position.column}`;
      this.#updateOutlineSelection(event.position);
      this.#invalidateSuggestions();
      if (this.#activePath && this.#primary.getModel())
        this.#scheduleSuggestionRefresh();
    });
    this.#primary.onKeyDown((event) => {
      if (
        event.keyCode === monaco.KeyCode.Escape ||
        event.keyCode === monaco.KeyCode.Tab
      )
        this.#invalidateSuggestions();
    });
    this.#primary.onDidChangeModel(() => {
      this.#invalidateSuggestions();
      const model = this.#primary.getModel();
      const tab = model
        ? [...this.#tabController.tabs()].find(
            (candidate) => candidate.model === model,
          )
        : undefined;
      if (tab && tab.path !== this.#activePath) this.#reflectActiveTab(tab);
    });
    monaco.editor.registerEditorOpener({
      openCodeEditor: (_source, resource, selectionOrPosition) => {
        const tab = this.#tabController.byPath(resource.toString());
        if (!tab) return false;
        this.#activateTab(tab);
        if (selectionOrPosition) {
          const position =
            "startLineNumber" in selectionOrPosition
              ? {
                  lineNumber: selectionOrPosition.startLineNumber,
                  column: selectionOrPosition.startColumn,
                }
              : selectionOrPosition;
          if ("startLineNumber" in selectionOrPosition)
            this.#primary.setSelection(selectionOrPosition);
          else this.#primary.setPosition(selectionOrPosition);
          this.#primary.revealPositionInCenter(position);
        }
        return true;
      },
    });
    this.#bindUi();
    this.#bindResizers();
    await this.#ensureInitialContent();
    await this.#restoreRecovery();
    if (!this.#activePath) await this.#openFirstInterlisFile();
    await this.#syncWorkspaceSources("startup");
    await this.renderSidebar();
    this.#updateWorkspaceStatus();
    this.#log("OPFS workspace and recovery services are ready.");
    this.#renderDiagramStatus("Save or compile to create a diagram.");
    this.#syncAuxiliaryLayout();
    const active = this.#activePath
      ? this.#tabController.byPath(this.#activePath)
      : undefined;
    if (active)
      await this.languageService.compileDocument(
        active.model.uri.toString(),
        "startup",
      );
  }

  async publishCompilation(event: CompilationEvent): Promise<void> {
    this.output.textContent = formatCompilationOutputForDisplay(event);
    this.#renderProblems(event);
    this.#required("#result-status").textContent = event.compilation.success
      ? `${event.compilation.errorCount} errors, ${event.compilation.warningCount} warnings`
      : `failed — ${event.compilation.errorCount} errors, ${event.compilation.warningCount} warnings`;
    this.#required("#compile-status").textContent = event.compilation.success
      ? "INTERLIS: compiled"
      : `INTERLIS: ${event.compilation.errorCount} error(s)`;
    if (event.trigger === "manual") this.#selectPanelView("output");
    const snapshot = event.semantic.value;
    if (!event.compilation.success || !snapshot?.success) {
      const state = this.#diagram.stale(
        "Showing the last valid diagram; compilation failed.",
      );
      if (this.#diagramVisible) {
        if (!state.snapshot) this.#renderDiagramStatus(state.message);
        else if (!this.#updateDiagramStatus(state.message, state.status))
          await this.#renderDiagram();
      }
      return;
    }
    this.#diagram.publish(
      snapshot,
      event.semantic.freshness === "fresh" ? "fresh" : "stale",
    );
    if (this.#diagramVisible) await this.#renderDiagram();
  }

  logError(operation: string, error: unknown): void {
    console.error(`${operation} failed`, error);
    this.#log(
      `${operation} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  logActivity(message: string): void {
    this.#log(message);
  }

  setSourceControlRenderer(
    renderer: () => HTMLElement | Promise<HTMLElement>,
  ): void {
    this.#sourceControlRenderer = renderer;
  }

  onWorkspaceChanged(listener: () => void): { dispose(): void } {
    this.#workspaceListeners.add(listener);
    return { dispose: () => this.#workspaceListeners.delete(listener) };
  }

  get activeWorkspace(): WorkspaceFileSystem {
    return this.#workspace;
  }
  get output(): HTMLElement {
    return this.#required("#output");
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#suggestionRefresh.cancel();
    this.#outlineRefresh.cancel();
    this.#suggestionRequests.invalidate();
    this.#diagramInteractionController?.abort();
    this.#diagramInteractionController = null;
    for (const tab of this.#tabController.tabs()) {
      tab.language.dispose();
      tab.model.dispose();
    }
    this.#tabController.dispose();
    this.#saveController.dispose();
    this.#recoveryController.dispose();
    this.#workspaceListeners.clear();
    this.#commandRegistry.dispose();
  }

  #selectPanelView(view: "problems" | "output"): void {
    this.#required("#problems").classList.toggle("hidden", view !== "problems");
    this.output.classList.toggle("hidden", view !== "output");
    for (const button of this.host.querySelectorAll<HTMLElement>(
      "[data-panel-view]",
    ))
      button.classList.toggle("active", button.dataset.panelView === view);
  }

  #renderProblems(event: CompilationEvent): void {
    const host = this.#required("#problems");
    const { diagnostics, errorCount, warningCount } = event.compilation;
    const problems = projectProblems(diagnostics, event.rootUri);
    this.#problemStore.replace(event.rootUri, problems);
    const problemCount = this.#required("#problem-count");
    problemCount.textContent = errorCount > 0 ? String(errorCount) : "";
    problemCount.classList.toggle("hidden", errorCount === 0);
    problemCount.setAttribute(
      "title",
      `${errorCount} errors, ${warningCount} warnings`,
    );
    const summary = document.createElement("p");
    summary.className = "problems-summary";
    summary.textContent = `${errorCount} errors, ${warningCount} warnings`;
    const rows = problems.map((problem) => {
      const row = document.createElement("button");
      const severity = problem.severity;
      const range = problem.range;
      row.className = `problem-row ${severity}`;
      row.dataset.severity = severity;
      row.innerHTML = "";
      const location = range
        ? `${this.#labelForUri(range.uri)}:${range.start.line + 1}:${range.start.character + 1}`
        : this.#labelForUri(event.rootUri);
      const heading = document.createElement("span");
      heading.className = "problem-heading";
      heading.textContent = `${severity.toUpperCase()} ${location} [${problem.code || "none"}]`;
      const message = document.createElement("span");
      message.className = "problem-message";
      message.textContent = problem.message;
      row.append(heading, message);
      if (problem.notes.length > 0 || problem.relatedInformation.length > 0) {
        const details = document.createElement("span");
        details.className = "problem-details";
        for (const note of problem.notes) {
          const item = document.createElement("span");
          item.textContent = `Note: ${note}`;
          details.append(item);
        }
        for (const related of problem.relatedInformation) {
          const item = document.createElement("button");
          item.type = "button";
          item.textContent = `Related: ${related.message}`;
          item.addEventListener("click", (click) => {
            click.stopPropagation();
            void this.#navigateToProblem(
              {
                id: "related-navigation",
                uri: related.uri,
                severity: "information",
                code: problem.code,
                source: problem.source,
                message: related.message,
                range: related.range,
                relatedInformation: [],
                notes: [],
              },
              event.rootUri,
            );
          });
          details.append(item);
        }
        row.append(details);
      }
      row.addEventListener(
        "click",
        () => void this.#navigateToProblem(problem, event.rootUri),
      );
      return row;
    });
    if (rows.length === 0) {
      const empty = document.createElement("p");
      empty.className = "panel-empty";
      empty.textContent = "No diagnostics.";
      host.replaceChildren(summary, empty);
    } else host.replaceChildren(summary, ...rows);
  }

  async #navigateToProblem(
    problem: ProblemItem,
    rootUri: string,
  ): Promise<void> {
    await this.#navigateToDiagnostic(
      {
        severity: problem.severity,
        code: problem.code,
        message: problem.message,
        range: problem.range,
        relatedInformation: [...problem.relatedInformation],
        notes: [...problem.notes],
        treatedAsError: problem.severity === "error",
        source: problem.source,
      },
      rootUri,
    );
  }

  async #navigateToDiagnostic(
    diagnostic: Diagnostic,
    rootUri: string,
  ): Promise<void> {
    const uri = diagnostic.range?.uri ?? rootUri;
    if (this.languageService.getRepositoryDocument(uri))
      await this.openRepositoryModel(uri);
    else {
      const existing = [...this.#tabController.tabs()].find(
        (tab) => tab.model.uri.toString() === uri,
      );
      if (existing) this.#activateTab(existing);
      else {
        try {
          const path = new URL(uri).pathname;
          if (await this.#exists(path)) await this.openFile(path);
        } catch {
          return;
        }
      }
    }
    const range = diagnostic.range;
    if (!range) return;
    const selection = problemSelection({
      id: "navigation",
      uri,
      severity: diagnostic.severity,
      code: diagnostic.code,
      source: diagnostic.source,
      message: diagnostic.message,
      range,
      relatedInformation: diagnostic.relatedInformation.flatMap((value) =>
        value.range
          ? [
              {
                uri: value.range.uri,
                message: value.message,
                range: value.range,
              },
            ]
          : [],
      ),
      notes: diagnostic.notes,
    });
    if (!selection) return;
    this.#primary.setSelection(selection);
    this.#primary.revealRangeInCenter(selection);
    this.#primary.focus();
  }

  #labelForUri(uri: string): string {
    return (
      [...this.#tabController.tabs()].find((tab) => tab.model.uri.toString() === uri)
        ?.label ?? uri
    );
  }
  get hasDirtyBuffers(): boolean {
    return [...this.#tabController.tabs()].some((tab) => !tab.readOnly && tab.dirty);
  }

  setGitStatus(status: string): void {
    this.#required("#git-status").textContent = status;
  }

  async reloadWorkspace(): Promise<void> {
    this.#disposeTabs();
    await this.#openFirstInterlisFile();
    await this.renderSidebar();
  }

  async openFile(path: string): Promise<void> {
    const normalized = normalizePath(path);
    let tab = this.#tabController.byPath(normalized);
    if (!tab) {
      const content = fileText(await this.#workspace.read(normalized));
      const uri = monaco.Uri.parse(this.#modelUri(normalized));
      const model =
        monaco.editor.getModel(uri) ??
        monaco.editor.createModel(content, "interlis", uri);
      tab = {
        path: normalized,
        label: normalized.split("/").at(-1) ?? normalized,
        model,
        readOnly: false,
        dirty: false,
        language: this.languageAdapter.attachModel(model),
      };
      this.#tabController.upsert(tab);
      model.onDidChangeContent(() => this.#onModelChanged(tab!));
    }
    this.#activateTab(tab);
  }

  ensureRepositoryModel(uri: string): Promise<void> {
    const document = this.languageService.getRepositoryDocument(uri);
    if (!document) return Promise.resolve();
    this.languageService.prepareRepositoryDocument(uri);
    let tab = this.#tabController.byPath(uri);
    if (!tab) {
      const modelUri = monaco.Uri.parse(uri);
      const source =
        typeof document.source === "string"
          ? document.source
          : new TextDecoder().decode(document.source);
      const model =
        monaco.editor.getModel(modelUri) ??
        monaco.editor.createModel(source, "interlis", modelUri);
      tab = {
        path: uri,
        label: `${document.model}.ili`,
        model,
        readOnly: true,
        dirty: false,
        language: this.languageAdapter.attachModel(model, { readOnly: true }),
      };
      this.#tabController.upsert(tab);
      this.#renderTabs();
    }
    return Promise.resolve();
  }

  async openRepositoryModel(uri: string): Promise<void> {
    await this.ensureRepositoryModel(uri);
    const tab = this.#tabController.byPath(uri);
    if (tab) this.#activateTab(tab);
  }

  async saveActive(): Promise<void> {
    if (!this.#activePath) return;
    const tab = this.#tabController.byPath(this.#activePath);
    if (!tab || tab.readOnly) {
      if (tab?.readOnly) this.#log("Repository models are read-only.");
      return;
    }
    await this.#saveTab(tab, true);
  }

  async #saveTab(tab: OpenTab, compile: boolean): Promise<void> {
    await this.#saveController.save(tab, { compile });
    await this.#recoveryController.clear(tab.model.uri.toString());
    this.#renderTabs();
    this.#log(`Saved ${tab.path}`);
    await this.renderSidebar();
  }

  async closeActiveEditor(): Promise<void> {
    const tab = this.#activePath ? this.#tabController.byPath(this.#activePath) : undefined;
    if (tab) await this.#requestCloseTab(tab);
  }

  private async deleteFile(path: string): Promise<void> {
    const normalized = normalizePath(path);
    const tab = this.#tabController.byPath(normalized);
    const dialog = this.#required<HTMLDialogElement>("#delete-file-dialog");
    const title = this.#required("#delete-file-title");
    const message = this.#required("#delete-file-message");
    const saveDelete = this.#required<HTMLButtonElement>(
      '[data-delete-file-action="save-delete"]',
    );
    const deleteButton = this.#required<HTMLButtonElement>(
      '[data-delete-file-action="delete"]',
    );
    title.textContent = normalized.toLowerCase().endsWith(".ili")
      ? "Delete model?"
      : "Delete file?";
    message.textContent = `Delete ${normalized}? This cannot be undone.`;
    saveDelete.classList.toggle("hidden", !tab?.dirty);
    deleteButton.textContent = tab?.dirty ? "Delete without Saving" : "Delete";
    dialog.returnValue = "cancel";
    dialog.showModal();
    const decision = await this.#waitForDialog(dialog);
    if (decision === "cancel") return;

    if (decision === "save-delete" && tab) {
      try {
        await this.#saveTab(tab, false);
      } catch (error) {
        this.logError(`Save ${normalized}`, error);
        return;
      }
    }

    try {
      await this.#workspace.delete(normalized);
    } catch (error) {
      this.logError(`Delete ${normalized}`, error);
      return;
    }
    this.#workspaceSourceSynchronizer.remove(this.#modelUri(normalized));
    if (tab && this.#tabController.byPath(normalized) !== null) await this.#closeTab(tab);
    await this.renderSidebar();
    const active = this.#activePath
      ? this.#tabController.byPath(this.#activePath)
      : undefined;
    if (active && normalized.toLowerCase().endsWith(".ili"))
      await this.languageService.compileDocument(
        active.model.uri.toString(),
        "save",
      );
    this.#log(`Deleted ${normalized}`);
  }

  async #requestCloseTab(tab: OpenTab): Promise<boolean> {
    if (tab.dirty && !tab.readOnly) {
      const decision = await this.#confirmClose(tab);
      if (decision === "cancel") return false;
      if (decision === "save") {
        try {
          await this.#saveTab(tab, tab.path === this.#activePath);
        } catch (error) {
          this.logError(`Save ${tab.label}`, error);
          return false;
        }
      } else await this.#recoveryController.clear(tab.model.uri.toString());
    }
    await this.#closeTab(tab);
    return true;
  }

  #confirmClose(tab: OpenTab): Promise<"save" | "discard" | "cancel"> {
    const dialog = this.#required<HTMLDialogElement>("#close-editor-dialog");
    if (dialog.open) return Promise.resolve("cancel");
    this.#required("#close-editor-message").textContent =
      `Do you want to save the changes to ${tab.label}?`;
    dialog.returnValue = "cancel";
    dialog.showModal();
    return new Promise((resolve) => {
      dialog.addEventListener(
        "close",
        () => {
          const value = dialog.returnValue;
          resolve(value === "save" || value === "discard" ? value : "cancel");
        },
        { once: true },
      );
    });
  }

  #waitForDialog(dialog: HTMLDialogElement): Promise<string> {
    return new Promise((resolve) => {
      dialog.addEventListener("close", () => resolve(dialog.returnValue), {
        once: true,
      });
    });
  }

  async #closeTab(tab: OpenTab): Promise<void> {
    const ordered = [...this.#tabController.tabs()];
    const index = ordered.indexOf(tab);
    const wasActive = tab.path === this.#activePath;
    if (
      wasActive &&
      tab.label.toLowerCase().endsWith(".ili") &&
      this.#diagramPreferredVisible
    )
      this.#hideDiagram();
    this.#saveController.cancelAutoSave(tab.path);
    if (!tab.readOnly) await this.#recoveryController.clear(tab.model.uri.toString());
    if (this.#primary.getModel() === tab.model) this.#primary.setModel(null);
    if (this.#secondary?.getModel() === tab.model)
      this.#secondary.setModel(null);
    tab.language.dispose();
    tab.model.dispose();
    this.#tabController.close(tab.path);
    if (wasActive) {
      const remaining = [...this.#tabController.tabs()];
      const next = remaining[index] ?? remaining[index - 1];
      if (next) this.#activateTab(next);
      else {
        this.#activePath = null;
        this.#primary.updateOptions({ readOnly: false });
        this.#required("#breadcrumbs").textContent = "No file open";
        this.#required("#cursor-status").textContent = "Ln 1, Col 1";
        this.#renderTabs();
        void this.#renderOutline();
      }
    } else this.#renderTabs();
  }

  async renderSidebar(): Promise<void> {
    const generation = ++this.#sidebarGeneration;
    const activeView = this.#activeView;
    const title = this.#required("#sidebar-title");
    const content = this.#required("#sidebar-content");
    const next = document.createElement("div");
    if (activeView === "explorer") await this.#renderExplorer(next);
    else if (activeView === "search") this.#renderSearch(next);
    else if (activeView === "outline") {
      this.#outlineRefresh.cancel();
      await this.#renderOutline(next);
    } else if (activeView === "settings") this.#renderSettings(next);
    else if (activeView === "scm") {
      if (this.#sourceControlRenderer)
        next.append(await this.#sourceControlRenderer());
      else this.#renderScmPlaceholder(next);
    }
    if (generation !== this.#sidebarGeneration) return;
    title.textContent = activeView.toUpperCase();
    this.#required("#outline-collapse-all").classList.toggle(
      "hidden",
      activeView !== "outline",
    );
    content.replaceChildren(...next.childNodes);
    if (activeView === "outline") this.#updateOutlineSelection();
  }

  async newFile(content = sampleModel): Promise<void> {
    let index = 1;
    let path = `/Untitled-${index}.ili`;
    while (await this.#exists(path)) path = `/Untitled-${++index}.ili`;
    await this.#workspace.write(path, textFile(""));
    this.#workspaceSourceSynchronizer.put({
      uri: this.#modelUri(path),
      text: "",
    });
    await this.openFile(path);
    this.#tabController.byPath(path)?.model.setValue(content);
    await this.renderSidebar();
  }

  async newFromRemoteTemplate(): Promise<void> {
    try {
      await this.newFile(await fetchTemplate(undefined));
      this.#log("Opened a new unsaved document from the remote template.");
    } catch (error) {
      this.logError("Remote template", error);
    }
  }

  async openLocalFolder(): Promise<void> {
    try {
      let handle = await this.#handleStore.load("active-local-folder");
      let local = handle ? new LocalFolderWorkspace(handle) : null;
      if (local && (await local.checkPermission()) !== "connected") {
        this.#updateWorkspaceStatus("Reconnect local folder");
        if (!(await local.reconnect())) local = null;
      }
      if (!local) {
        local = await LocalFolderWorkspace.pick();
        handle = local.root;
        await this.#handleStore.save("active-local-folder", handle);
      }
      const descriptor: WorkspaceDescriptor = {
        id: "local-folder",
        name: handle?.name ?? "Local Folder",
        kind: "local-folder",
        createdAt: new Date().toISOString(),
      };
      this.manager.mountLocal(descriptor, local);
      await this.#switchFileSystem(local);
      this.#log(`Opened local folder ${descriptor.name}`);
    } catch (error) {
      this.#log(
        `Local folder was not opened: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async exportZip(): Promise<void> {
    downloadBytes(
      await exportWorkspaceZip(this.#workspace),
      `${this.manager.activeDescriptor?.name ?? "workspace"}.zip`,
      "application/zip",
    );
    this.#log("Exported workspace ZIP.");
  }

  async compileWorkspace(): Promise<void> {
    const active = this.#activePath ? this.#tabController.byPath(this.#activePath) : null;
    if (!active) return;
    await this.languageService.compileDocument(
      active.model.uri.toString(),
      "manual",
    );
  }

  async showDiagram(force = false): Promise<void> {
    this.#diagramPreferredVisible = true;
    this.#layout = { ...this.#layout, diagramVisible: true };
    this.#persistLayout();
    if (this.#secondary) {
      this.#secondary.dispose();
      this.#secondary = null;
      this.#required("#editor-secondary").classList.add("hidden");
    }
    this.#syncAuxiliaryLayout();
    const saved = this.languageService.getSavedSemanticSnapshot(
      this.#activeDocumentUri(),
    );
    if (!saved?.value) {
      this.#renderDiagramStatus("No saved snapshot — save or compile first.");
      return;
    }
    if (force)
      this.#diagram.publish(
        saved.value,
        saved.freshness === "fresh" ? "fresh" : "stale",
      );
    await this.#renderDiagram();
  }

  async toggleDiagram(): Promise<void> {
    if (this.#diagramPreferredVisible && this.#diagramVisible) {
      this.#hideDiagram();
      return;
    }
    await this.showDiagram();
  }

  #hideDiagram(): void {
    this.#diagramPreferredVisible = false;
    this.#diagramVisible = false;
    this.#layout = { ...this.#layout, diagramVisible: false };
    this.#persistLayout();
    this.#syncAuxiliaryLayout();
  }

  async exportSvg(): Promise<void> {
    if (!this.#diagramSvg) await this.showDiagram(true);
    if (!this.#diagramSvg) {
      this.#log("SVG export skipped: no valid diagram is available.");
      return;
    }
    const name = `${this.#activeBaseName()}.svg`;
    downloadBytes(
      new TextEncoder().encode(this.#diagramSvg),
      name,
      "image/svg+xml",
    );
    this.#log(`Exported ${name}.`);
  }

  async exportDocx(): Promise<void> {
    const snapshot = this.languageService.getSavedSemanticSnapshot(
      this.#activeDocumentUri(),
    )?.value;
    if (!snapshot) {
      this.#log("DOCX export skipped: no semantic snapshot is available.");
      return;
    }
    const bytes = await generateDocx(snapshot, { includeDiagnostics: true });
    const name = `${this.#activeBaseName()}.docx`;
    if (this.manager.activeDescriptor?.kind === "local-folder") {
      const path = normalizePath(
        `${this.#activePath?.replace(/[^/]+$/u, "") ?? "/"}${name}`,
      );
      await this.#workspace.write(path, bytes, {
        create: true,
        overwrite: true,
      });
      await this.renderSidebar();
      this.#log(`Wrote ${path}.`);
    } else {
      downloadBytes(
        bytes,
        name,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
      this.#log(`Downloaded ${name}.`);
    }
  }

  private async newWorkspace(): Promise<void> {
    const descriptor = await this.manager.create(
      `Workspace ${this.manager.workspaces.length + 1}`,
    );
    await this.#switchFileSystem(this.manager.activeFileSystem);
    this.#log(`Created ${descriptor.name}`);
  }

  private async renameWorkspace(
    id = this.manager.activeDescriptor?.id,
  ): Promise<void> {
    const descriptor = this.manager.workspaces.find(
      (candidate) => candidate.id === id,
    );
    if (!descriptor) {
      this.#log("Only named workspaces can be renamed in the IDE.");
      return;
    }
    const dialog = this.#required<HTMLDialogElement>("#workspace-name-dialog");
    const input = this.#required<HTMLInputElement>("#workspace-name-input");
    input.value = descriptor.name;
    dialog.returnValue = "cancel";
    dialog.showModal();
    input.focus();
    input.select();
    if ((await this.#waitForDialog(dialog)) !== "save") return;
    try {
      await this.manager.rename(descriptor.id, input.value);
      this.#updateWorkspaceStatus();
      await this.renderSidebar();
      this.#log(
        `Renamed workspace to ${this.manager.activeDescriptor?.name ?? input.value}`,
      );
    } catch (error) {
      this.logError("Rename workspace", error);
    }
  }

  private async deleteWorkspace(
    id = this.manager.activeDescriptor?.id,
  ): Promise<void> {
    const descriptor = this.manager.workspaces.find(
      (candidate) => candidate.id === id,
    );
    if (!descriptor) {
      this.#log("Only named workspaces can be deleted in the IDE.");
      return;
    }
    if (this.manager.workspaces.length === 1) {
      this.#log("The last workspace cannot be deleted.");
      return;
    }
    const dialog = this.#required<HTMLDialogElement>(
      "#delete-workspace-dialog",
    );
    this.#required("#delete-workspace-message").textContent =
      `Delete workspace “${descriptor.name}”? All files in it will be deleted.`;
    dialog.returnValue = "cancel";
    dialog.showModal();
    if ((await this.#waitForDialog(dialog)) !== "delete") return;
    const wasActive = this.manager.activeDescriptor?.id === descriptor.id;
    try {
      await this.manager.remove(descriptor.id);
      if (wasActive)
        await this.#switchFileSystem(this.manager.activeFileSystem);
      else await this.renderSidebar();
      this.#log(`Deleted workspace ${descriptor.name}`);
    } catch (error) {
      this.logError("Delete workspace", error);
    }
  }

  private pickZip(): void {
    this.#required<HTMLInputElement>("#zip-input").click();
  }

  async #importDroppedFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;
    if (files.length !== 1) {
      this.#log("Only one .ili file can be imported at a time.");
      return;
    }
    const file = files[0];
    if (!file || !file.name.toLowerCase().endsWith(".ili")) {
      this.#log("Only .ili files can be imported via drag and drop.");
      return;
    }

    try {
      const path = await this.#uniqueDroppedFilePath(file.name);
      const bytes = new Uint8Array(await file.arrayBuffer());
      await this.#workspace.write(path, bytes, {
        create: true,
        overwrite: false,
      });
      this.#workspaceSourceSynchronizer.put({
        uri: this.#modelUri(path),
        text: fileText(bytes),
      });
      await this.openFile(path);
      await this.renderSidebar();
      this.#log(`Imported ${path}`);
    } catch (error) {
      this.logError("Import dropped file", error);
    }
  }

  async #uniqueDroppedFilePath(fileName: string): Promise<string> {
    const name = fileName.split(/[\\/]/u).at(-1)?.trim();
    if (!name || name === "." || name === "..")
      throw new Error("Dropped file has no valid name.");
    const path = normalizePath(`/${name}`);
    if (!(await this.#exists(path))) return path;

    const stem = name.slice(0, -4);
    for (let index = 2; ; index += 1) {
      const candidate = normalizePath(`/${stem}-${index}.ili`);
      if (!(await this.#exists(candidate))) return candidate;
    }
  }

  async #switchFileSystem(workspace: WorkspaceFileSystem): Promise<void> {
    this.#problemStore.clear();
    this.#required("#problems").replaceChildren();
    this.#disposeTabs();
    this.#resetLanguageDocuments();
    this.#workspace = workspace;
    this.#recoveryController.attach(workspace);
    this.#saveController.attach(workspace);
    await this.#ensureInitialContent();
    await this.#syncWorkspaceSources("workspace-switch");
    await this.#openFirstInterlisFile();
    await this.renderSidebar();
    this.#updateWorkspaceStatus();
    for (const listener of this.#workspaceListeners) listener();
  }

  #bindUi(): void {
    const shell = this.#required<HTMLElement>(".ide-shell");
    const hasFiles = (event: DragEvent): boolean =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");
    const clearDropState = (): void => {
      this.#dragDepth = 0;
      shell.classList.remove("drop-active");
    };
    shell.addEventListener("dragenter", (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      this.#dragDepth += 1;
      shell.classList.add("drop-active");
    });
    shell.addEventListener("dragover", (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      shell.classList.add("drop-active");
    });
    shell.addEventListener("dragleave", (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      this.#dragDepth = Math.max(0, this.#dragDepth - 1);
      if (this.#dragDepth === 0) shell.classList.remove("drop-active");
    });
    shell.addEventListener("drop", (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      clearDropState();
      void this.#importDroppedFiles(event.dataTransfer?.files ?? null);
    });
    this.host.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-command],[data-view],[data-panel-view]",
      );
      if (!target) return;
      const panelView = target.dataset.panelView;
      if (panelView === "problems" || panelView === "output")
        this.#selectPanelView(panelView);
      const view = target.dataset.view;
      if (view) {
        this.#cancelDeferredEditorRefreshes();
        this.#activeView = view;
        for (const button of this.host.querySelectorAll<HTMLElement>(
          "[data-view]",
        )) {
          button.classList.toggle("active", button === target);
          button.setAttribute(
            "aria-pressed",
            button === target ? "true" : "false",
          );
        }
        void this.renderSidebar();
      }
      const command = target.dataset.command;
      if (command === "command-palette") this.#showCommandPalette();
      else if (command === "toggle-search") {
        this.#cancelDeferredEditorRefreshes();
        this.#activeView = "search";
        void this.renderSidebar();
      } else if (command === "switch-workspace") this.#showWorkspacePicker();
      else {
        if (command) void this.#commandRegistry.execute(command);
      }
    });
    this.#required<HTMLInputElement>("#zip-input").addEventListener(
      "change",
      (event) => {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (!file) return;
        void file.arrayBuffer().then(async (buffer) => {
          const imported = await importWorkspaceZip(
            this.#workspace,
            new Uint8Array(buffer),
          );
          await this.#syncWorkspaceSources("zip-import");
          this.#log(`Imported ${imported.length} file(s) from ZIP.`);
          await this.renderSidebar();
        });
      },
    );
    const closeDialog = this.#required<HTMLDialogElement>(
      "#close-editor-dialog",
    );
    for (const button of closeDialog.querySelectorAll<HTMLButtonElement>(
      "[data-close-action]",
    )) {
      button.addEventListener("click", () => {
        closeDialog.returnValue = button.dataset.closeAction ?? "cancel";
        closeDialog.close();
      });
    }
    closeDialog.addEventListener("cancel", () => {
      closeDialog.returnValue = "cancel";
    });
    const deleteFileDialog = this.#required<HTMLDialogElement>(
      "#delete-file-dialog",
    );
    for (const button of deleteFileDialog.querySelectorAll<HTMLButtonElement>(
      "[data-delete-file-action]",
    )) {
      button.addEventListener("click", () => {
        deleteFileDialog.returnValue =
          button.dataset.deleteFileAction ?? "cancel";
        deleteFileDialog.close();
      });
    }
    deleteFileDialog.addEventListener("cancel", () => {
      deleteFileDialog.returnValue = "cancel";
    });
    const deleteWorkspaceDialog = this.#required<HTMLDialogElement>(
      "#delete-workspace-dialog",
    );
    for (const button of deleteWorkspaceDialog.querySelectorAll<HTMLButtonElement>(
      "[data-delete-workspace-action]",
    )) {
      button.addEventListener("click", () => {
        deleteWorkspaceDialog.returnValue =
          button.dataset.deleteWorkspaceAction ?? "cancel";
        deleteWorkspaceDialog.close();
      });
    }
    deleteWorkspaceDialog.addEventListener("cancel", () => {
      deleteWorkspaceDialog.returnValue = "cancel";
    });
    const workspaceNameDialog = this.#required<HTMLDialogElement>(
      "#workspace-name-dialog",
    );
    for (const button of workspaceNameDialog.querySelectorAll<HTMLButtonElement>(
      "[data-workspace-name-action]",
    )) {
      button.addEventListener("click", () => {
        workspaceNameDialog.returnValue =
          button.dataset.workspaceNameAction ?? "cancel";
        workspaceNameDialog.close();
      });
    }
    workspaceNameDialog.addEventListener("cancel", () => {
      workspaceNameDialog.returnValue = "cancel";
    });
    workspaceNameDialog
      .querySelector("form")
      ?.addEventListener("submit", (event) => {
        event.preventDefault();
        workspaceNameDialog.returnValue = "save";
        workspaceNameDialog.close();
      });
    window.addEventListener(
      "pointerdown",
      (event) => {
        const palette = this.#required("#quick-pick");
        if (
          palette.matches(":popover-open") &&
          event.target instanceof Node &&
          !palette.contains(event.target)
        )
          this.#hideQuickPick();
      },
      { capture: true },
    );
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.#hideQuickPick();
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void this.saveActive();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "w") {
        event.preventDefault();
        void this.closeActiveEditor();
      }
      if (
        event.key === "F1" ||
        ((event.metaKey || event.ctrlKey) &&
          event.shiftKey &&
          event.key.toLowerCase() === "p")
      ) {
        event.preventDefault();
        this.#showCommandPalette();
      }
    });
    window.addEventListener("resize", () => this.#applyLayoutSettings());
  }

  async #renderExplorer(host: HTMLElement): Promise<void> {
    const openEditors = document.createElement("section");
    openEditors.className = "open-editors";
    openEditors.dataset.openEditors = "";
    const openEditorsHeading = document.createElement("button");
    openEditorsHeading.className = "explorer-section-heading";
    openEditorsHeading.setAttribute(
      "aria-expanded",
      String(!this.#openEditorsCollapsed),
    );
    openEditorsHeading.append(
      this.#icon(this.#openEditorsCollapsed ? "chevron-right" : "chevron-down"),
      document.createTextNode("OPEN EDITORS"),
    );
    const count = document.createElement("span");
    count.className = "section-count";
    count.textContent = String(this.#tabController.tabs().length);
    openEditorsHeading.append(count);
    openEditorsHeading.addEventListener("click", () => {
      this.#openEditorsCollapsed = !this.#openEditorsCollapsed;
      this.#renderOpenEditors(openEditors);
    });
    openEditors.append(openEditorsHeading);
    this.#renderOpenEditors(openEditors);
    host.append(openEditors);

    const toolbar = document.createElement("div");
    toolbar.className = "sidebar-toolbar";
    const toolbarCommands: Array<[string, string, string]> = [
      ["New file", "new-file", "new-file"],
      ["Open folder", "open-folder", "folder-opened"],
      ["Import ZIP", "import-zip", "file-zip"],
      ["Export ZIP", "export-zip", "export"],
    ];
    for (const [label, command, icon] of toolbarCommands) {
      const button = document.createElement("button");
      button.dataset.command = command;
      button.append(this.#icon(icon), document.createTextNode(label));
      toolbar.append(button);
    }
    host.append(toolbar);
    const tree = document.createElement("div");
    tree.className = "file-tree";
    await this.#appendDirectory(tree, "/", 0);
    host.append(tree);
  }

  async #appendDirectory(
    host: HTMLElement,
    path: string,
    depth: number,
  ): Promise<void> {
    for (const [name, type] of await this.#workspace.readDirectory(path)) {
      if (name === ".recovery" || name === ".interlis" || name === ".git")
        continue;
      const child = normalizePath(`${path}/${name}`);
      const row = document.createElement("div");
      row.className = `file-row ${type}`;
      row.style.paddingLeft = `${8 + depth * 14}px`;
      const label = document.createElement(type === "file" ? "button" : "span");
      label.className = "file-open";
      const labelText = document.createElement("span");
      labelText.textContent = name;
      label.append(
        this.#icon(
          type === "directory"
            ? "folder-opened"
            : name.endsWith(".ili")
              ? "file-code"
              : "file",
        ),
        labelText,
      );
      if (type === "file") {
        label.title = child;
        label.addEventListener("click", () => void this.openFile(child));
        const deleteButton = document.createElement("button");
        deleteButton.className = "file-delete";
        deleteButton.setAttribute(
          "aria-label",
          `${name.toLowerCase().endsWith(".ili") ? "Delete model" : "Delete file"} ${name}`,
        );
        deleteButton.title = `${name.toLowerCase().endsWith(".ili") ? "Delete model" : "Delete file"} ${name}`;
        deleteButton.append(this.#icon("trash"));
        deleteButton.addEventListener(
          "click",
          () => void this.deleteFile(child),
        );
        row.append(label, deleteButton);
      } else row.append(label);
      host.append(row);
      if (type === "directory")
        await this.#appendDirectory(host, child, depth + 1);
    }
  }

  #renderOpenEditors(
    host = this.host.querySelector<HTMLElement>("[data-open-editors]"),
  ): void {
    if (!host) return;
    host.querySelector(".open-editors-list")?.remove();
    const heading = host.querySelector<HTMLElement>(
      ".explorer-section-heading",
    );
    if (heading) {
      heading.setAttribute(
        "aria-expanded",
        String(!this.#openEditorsCollapsed),
      );
      const icon = heading.querySelector<HTMLElement>(".codicon");
      if (icon)
        icon.className = `codicon codicon-${
          this.#openEditorsCollapsed ? "chevron-right" : "chevron-down"
        }`;
      const count = heading.querySelector<HTMLElement>(".section-count");
      if (count) count.textContent = String(this.#tabController.tabs().length);
    }
    if (this.#openEditorsCollapsed) return;
    const list = document.createElement("div");
    list.className = "open-editors-list";
    for (const tab of this.#tabController.tabs()) {
      const row = document.createElement("div");
      row.className = [
        "open-editor-row",
        tab.path === this.#activePath ? "active" : "",
        tab.dirty ? "dirty" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const label = document.createElement("button");
      label.className = "open-editor-label";
      label.title = tab.path;
      label.append(
        this.#icon(tab.readOnly ? "lock" : "file-code"),
        Object.assign(document.createElement("span"), {
          textContent: tab.label,
        }),
      );
      label.addEventListener("click", () => this.#activateTab(tab));
      const close = document.createElement("button");
      close.className = "open-editor-close";
      close.tabIndex = 0;
      if (tab.dirty) close.classList.add("dirty-close");
      close.setAttribute("aria-label", `Close ${tab.label}`);
      close.title = `Close ${tab.label}`;
      if (tab.dirty) close.append(this.#icon("close-dirty"));
      close.append(this.#icon("close"));
      close.addEventListener("click", () => void this.#requestCloseTab(tab));
      row.append(label, close);
      list.append(row);
    }
    host.append(list);
  }

  #renderSearch(host: HTMLElement): void {
    const input = document.createElement("input");
    input.className = "search-input";
    input.placeholder = "Search files";
    const results = document.createElement("div");
    input.addEventListener(
      "input",
      () => void this.#search(input.value, results),
    );
    host.append(input, results);
  }

  async #search(query: string, host: HTMLElement): Promise<void> {
    host.replaceChildren();
    if (!query.trim()) return;
    const files: string[] = [];
    const walk = async (path: string): Promise<void> => {
      for (const [name, type] of await this.#workspace.readDirectory(path)) {
        const child = normalizePath(`${path}/${name}`);
        if (type === "directory") await walk(child);
        else files.push(child);
      }
    };
    await walk("/");
    for (const path of files) {
      const text = fileText(await this.#workspace.read(path));
      if (
        !path.toLowerCase().includes(query.toLowerCase()) &&
        !text.toLowerCase().includes(query.toLowerCase())
      )
        continue;
      const row = document.createElement("button");
      row.className = "search-result";
      row.textContent = path;
      row.addEventListener("click", () => void this.openFile(path));
      host.append(row);
    }
  }

  async #renderOutline(
    host = this.#required("#sidebar-content"),
  ): Promise<void> {
    if (this.#activeView !== "outline") return;
    const generation = ++this.#outlineGeneration;
    this.#outlineRefresh.cancel();
    host.replaceChildren();
    this.#outlineEntries.clear();
    const model = this.#primary?.getModel();
    if (!model) return;
    const uri = model.uri.toString();
    const version = model.getVersionId();
    const symbols = await this.languageService.waitForDocumentSymbols(
      uri,
      version,
    );
    if (
      this.#activeView !== "outline" ||
      generation !== this.#outlineGeneration ||
      this.#primary.getModel() !== model ||
      model.getVersionId() !== version
    )
      return;
    if (symbols.length === 0) {
      host.append(
        Object.assign(document.createElement("p"), {
          className: "empty-view",
          textContent: "No symbols found.",
        }),
      );
      return;
    }
    const tree = document.createElement("div");
    tree.className = "outline-tree";
    tree.setAttribute("role", "tree");
    tree.setAttribute("aria-label", "Document symbols");
    this.#appendOutlineSymbols(tree, symbols, uri, "", 1);
    host.append(tree);
    this.#updateOutlineSelection();
  }

  #appendOutlineSymbols(
    host: HTMLElement,
    symbols: readonly DocumentSymbol[],
    uri: string,
    parentKey: string,
    level: number,
  ): void {
    const occurrences = new Map<string, number>();
    for (const symbol of symbols) {
      const identity = `${symbol.kind.toLowerCase()}:${symbol.name}`;
      const occurrence = occurrences.get(identity) ?? 0;
      occurrences.set(identity, occurrence + 1);
      const key = `${parentKey}/${encodeURIComponent(identity)}:${occurrence}`;
      const item = document.createElement("div");
      item.className = `outline-item${symbol.inherited ? " inherited" : ""}`;
      item.dataset.outlineKey = key;
      item.setAttribute("role", "treeitem");
      item.setAttribute("aria-level", String(level));
      item.setAttribute("aria-selected", "false");
      if (symbol.children.length > 0)
        item.setAttribute(
          "aria-expanded",
          String(!this.#outlineCollapsed.has(`${uri}:${key}`)),
        );

      const row = document.createElement("div");
      row.className = "outline-row";
      row.style.setProperty("--outline-level", String(level));
      if (symbol.children.length > 0) {
        const toggle = document.createElement("button");
        toggle.className = "outline-toggle";
        const collapsed = this.#outlineCollapsed.has(`${uri}:${key}`);
        toggle.setAttribute(
          "aria-label",
          `${collapsed ? "Expand" : "Collapse"} ${symbol.name}`,
        );
        toggle.append(this.#icon(collapsed ? "chevron-right" : "chevron-down"));
        toggle.addEventListener("click", () => {
          const storageKey = `${uri}:${key}`;
          if (this.#outlineCollapsed.has(storageKey))
            this.#outlineCollapsed.delete(storageKey);
          else this.#outlineCollapsed.add(storageKey);
          void this.#renderOutline();
        });
        row.append(toggle);
      } else {
        const spacer = document.createElement("span");
        spacer.className = "outline-spacer";
        row.append(spacer);
      }

      const label = document.createElement("button");
      label.className = "outline-label";
      label.title = [symbol.name, symbol.detail].filter(Boolean).join(" ");
      const icon = this.#icon(outlineCodiconName(symbol.kind));
      icon.classList.add("outline-icon");
      const name = document.createElement("span");
      name.className = "outline-name";
      name.textContent = symbol.name;
      label.append(icon, name);
      if (symbol.detail) {
        const detail = document.createElement("span");
        detail.className = "outline-detail";
        detail.textContent = symbol.detail;
        label.append(detail);
      }
      label.addEventListener("click", () =>
        this.#navigateToOutlineSymbol(symbol),
      );
      row.append(label);
      item.append(row);
      this.#outlineEntries.set(`${uri}:${key}`, {
        symbol,
        depth: level,
        row,
      });
      if (
        symbol.children.length > 0 &&
        !this.#outlineCollapsed.has(`${uri}:${key}`)
      ) {
        const group = document.createElement("div");
        group.setAttribute("role", "group");
        this.#appendOutlineSymbols(group, symbol.children, uri, key, level + 1);
        item.append(group);
      }
      host.append(item);
    }
  }

  #navigateToOutlineSymbol(symbol: DocumentSymbol): void {
    const range = symbol.selectionRange;
    const selection = {
      startLineNumber: range.start.line + 1,
      startColumn: range.start.character + 1,
      endLineNumber: range.end.line + 1,
      endColumn: range.end.character + 1,
    };
    this.#primary.setSelection(selection);
    this.#primary.revealRangeInCenter(selection);
    this.#primary.focus();
  }

  #updateOutlineSelection(
    position = this.#primary?.getPosition() ?? undefined,
  ): void {
    if (this.#activeView !== "outline" || !position) return;
    const line = position.lineNumber - 1;
    const character = position.column - 1;
    const contains = (symbol: DocumentSymbol): boolean => {
      const { start, end } = symbol.range;
      return (
        (line > start.line ||
          (line === start.line && character >= start.character)) &&
        (line < end.line || (line === end.line && character <= end.character))
      );
    };
    let selected:
      | {
          readonly symbol: DocumentSymbol;
          readonly depth: number;
          row: HTMLElement;
        }
      | undefined;
    for (const entry of this.#outlineEntries.values()) {
      entry.row.classList.remove("selected");
      entry.row.parentElement?.setAttribute("aria-selected", "false");
      if (
        contains(entry.symbol) &&
        (!selected || entry.depth >= selected.depth)
      )
        selected = entry;
    }
    selected?.row.classList.add("selected");
    selected?.row.parentElement?.setAttribute("aria-selected", "true");
  }

  #collapseOutline(): void {
    if (this.#activeView !== "outline") return;
    for (const [key, entry] of this.#outlineEntries)
      if (entry.symbol.children.length > 0) this.#outlineCollapsed.add(key);
    void this.#renderOutline();
  }

  #renderSettings(host: HTMLElement): void {
    const repositorySection = document.createElement("section");
    repositorySection.className = "settings-section repositories-settings";
    repositorySection.append(
      Object.assign(document.createElement("h4"), {
        textContent: "INTERLIS model repositories",
      }),
    );
    const repositoryList = document.createElement("div");
    repositoryList.className = "repository-list";
    let repositoryEntries = repositorySettingEntries(readRepositorySetting());

    const applyRepositories = (): void => {
      const invalid = repositoryEntries.find(
        (entry, index) => index > 0 && !/^https?:\/\//iu.test(entry.trim()),
      );
      if (invalid) return;
      const value = serializeRepositorySetting(repositoryEntries);
      repositoryEntries = repositorySettingEntries(value);
      localStorage.setItem(repositorySettingsKey, value);
      this.#renderRepositoryList(repositoryList, repositoryEntries, (next) => {
        repositoryEntries = next;
        applyRepositories();
      });
      void this.languageService
        .setModelRepository(
          createBrowserModelRepository(value, (message) =>
            this.logError("Model repository", message),
          ),
        )
        .then(() => this.#log("Repository settings updated."))
        .catch((error: unknown) => this.logError("Model repository", error));
    };

    const renderRepositories = (): void => {
      this.#renderRepositoryList(repositoryList, repositoryEntries, (next) => {
        repositoryEntries = next;
        applyRepositories();
      });
    };
    renderRepositories();
    repositorySection.append(repositoryList);
    const addRepository = document.createElement("button");
    addRepository.className = "settings-secondary-action";
    addRepository.textContent = "Add repository";
    addRepository.addEventListener("click", () => {
      repositoryEntries = [...repositoryEntries, ""];
      renderRepositories();
      repositoryList
        .querySelector<HTMLInputElement>(
          ".repository-row:last-child .repository-url",
        )
        ?.focus();
    });
    repositorySection.append(addRepository);
    repositorySection.append(
      Object.assign(document.createElement("p"), {
        className: "setting-help",
        textContent:
          "The listed mirrors are used directly in the browser; the master repository follows as the last source.",
      }),
    );
    host.append(repositorySection);

    const editorSection = document.createElement("section");
    editorSection.className = "settings-section";
    editorSection.append(
      Object.assign(document.createElement("h4"), { textContent: "Editor" }),
    );
    const fontSize = document.createElement("select");
    fontSize.setAttribute("aria-label", "Editor font size");
    for (const value of editorFontSizes) {
      const option = new Option(`${value}px`, String(value));
      option.selected = value === this.#editorSettings.fontSize;
      fontSize.add(option);
    }
    fontSize.addEventListener("change", () =>
      this.#updateEditorSettings({
        fontSize: Number(fontSize.value) as EditorSettings["fontSize"],
      }),
    );
    editorSection.append(this.#settingRow("Font Size", fontSize));

    const formatOnType = document.createElement("input");
    formatOnType.type = "checkbox";
    formatOnType.checked = this.#editorSettings.formatOnType;
    formatOnType.setAttribute("aria-label", "Editor format on type");
    formatOnType.addEventListener("change", () =>
      this.#updateEditorSettings({ formatOnType: formatOnType.checked }),
    );
    editorSection.append(this.#settingRow("Format On Type", formatOnType));

    const autoSave = document.createElement("select");
    autoSave.setAttribute("aria-label", "Files auto save");
    for (const [label, value] of [
      ["Off", "off"],
      ["After Delay", "afterDelay"],
    ] as const) {
      const option = new Option(label, value);
      option.selected = value === this.#editorSettings.autoSave;
      autoSave.add(option);
    }
    autoSave.addEventListener("change", () =>
      this.#updateEditorSettings({
        autoSave: autoSave.value as EditorSettings["autoSave"],
      }),
    );
    editorSection.append(this.#settingRow("Auto Save", autoSave));
    host.append(editorSection);

    const diagramSection = document.createElement("section");
    diagramSection.className = "settings-section";
    diagramSection.append(
      Object.assign(document.createElement("h4"), {
        textContent: "Diagram",
      }),
    );
    const routing = document.createElement("select");
    routing.setAttribute("aria-label", "Diagram edge routing");
    for (const value of ["POLYLINE", "ORTHOGONAL", "SPLINES"] as const) {
      const option = new Option(value, value);
      option.selected = value === this.#diagramSettings.edgeRouting;
      routing.add(option);
    }
    routing.addEventListener("change", () => {
      this.#updateDiagramSettings({
        edgeRouting: routing.value as DiagramSettings["edgeRouting"],
      });
    });
    diagramSection.append(this.#settingRow("Edge routing", routing));

    const attributes = document.createElement("select");
    attributes.setAttribute("aria-label", "Diagram attributes");
    for (const value of ["OWN", "OWN_AND_INHERITED", "NONE"] as const) {
      const option = new Option(value.replaceAll("_", " "), value);
      option.selected = value === this.#diagramSettings.attributeMode;
      attributes.add(option);
    }
    attributes.addEventListener("change", () => {
      this.#updateDiagramSettings({
        attributeMode: attributes.value as DiagramSettings["attributeMode"],
      });
    });
    diagramSection.append(this.#settingRow("Attributes", attributes));

    const toggles: Array<[string, keyof DiagramSettings]> = [
      ["De-emphasize abstract types", "deemphasizeAbstractTypes"],
      ["Show association names", "showAssociationNames"],
      ["Show role cardinalities", "showRoleCardinalities"],
      ["Show local enum values", "showLocalEnumerationValues"],
    ];
    for (const [label, key] of toggles) {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = Boolean(this.#diagramSettings[key]);
      input.setAttribute("aria-label", `Diagram ${label}`);
      input.addEventListener("change", () =>
        this.#updateDiagramSettings({ [key]: input.checked }),
      );
      diagramSection.append(this.#settingRow(label, input));
    }
    const rememberVisibility = document.createElement("input");
    rememberVisibility.type = "checkbox";
    rememberVisibility.checked = this.#editorSettings.rememberDiagramVisibility;
    rememberVisibility.setAttribute(
      "aria-label",
      "Diagram visibility remembered",
    );
    rememberVisibility.addEventListener("change", () =>
      this.#updateEditorSettings({
        rememberDiagramVisibility: rememberVisibility.checked,
      }),
    );
    diagramSection.append(
      this.#settingRow("Visibility Remembered", rememberVisibility),
    );
    host.append(diagramSection);
  }

  #renderRepositoryList(
    host: HTMLElement,
    entries: readonly string[],
    onChange: (entries: string[]) => void,
  ): void {
    host.replaceChildren();
    entries.forEach((entry, index) => {
      const row = document.createElement("div");
      row.className = "repository-row";
      const details = document.createElement("div");
      details.className = "repository-details";
      const label = document.createElement("span");
      label.className = "repository-label";
      label.textContent = repositoryEntryLabel(entry);
      details.append(label);
      if (entry === "%ILI_DIR") {
        const value = document.createElement("span");
        value.className = "repository-value repository-value-readonly";
        value.textContent = entry;
        details.append(value);
      } else {
        const input = document.createElement("input");
        input.className = "repository-url";
        input.type = "url";
        input.value = entry;
        input.setAttribute("aria-label", `${repositoryEntryLabel(entry)} URL`);
        input.addEventListener("input", () => {
          label.textContent = repositoryEntryLabel(input.value.trim());
          input.setCustomValidity("");
        });
        input.addEventListener("change", () => {
          const next = [...entries];
          next[index] = input.value.trim();
          if (!/^https?:\/\//iu.test(next[index])) {
            input.setCustomValidity("Enter a public HTTP(S) repository URL.");
            input.reportValidity();
            return;
          }
          onChange(next);
        });
        details.append(input);
      }
      row.append(details);
      if (entry !== "%ILI_DIR") {
        const remove = document.createElement("button");
        remove.className = "repository-remove";
        remove.type = "button";
        remove.textContent = "Remove";
        remove.setAttribute(
          "aria-label",
          `Remove ${repositoryEntryLabel(entry)}`,
        );
        remove.addEventListener("click", () => {
          const next = [...entries];
          next.splice(index, 1);
          onChange(next);
        });
        row.append(remove);
      }
      host.append(row);
    });
  }

  #settingRow(label: string, control: HTMLElement): HTMLElement {
    const row = document.createElement("label");
    row.className = "setting-row setting-control";
    row.append(document.createTextNode(label), control);
    return row;
  }

  #updateEditorSettings(changes: Partial<EditorSettings>): void {
    const previous = this.#editorSettings;
    this.#editorSettings = { ...this.#editorSettings, ...changes };
    writeEditorSettings(this.#editorSettings);
    void updateVscodeEditorSettings(this.#editorSettings).catch(
      (error: unknown) => this.logError("Editor settings", error),
    );
    this.#primary.updateOptions({
      fontSize: this.#editorSettings.fontSize,
      formatOnType: this.#editorSettings.formatOnType,
    });
    this.#secondary?.updateOptions({
      fontSize: this.#editorSettings.fontSize,
      formatOnType: this.#editorSettings.formatOnType,
    });
    if (
      previous.rememberDiagramVisibility !==
      this.#editorSettings.rememberDiagramVisibility
    ) {
      this.#layout = {
        ...this.#layout,
        diagramVisible: this.#editorSettings.rememberDiagramVisibility
          ? this.#diagramPreferredVisible
          : defaultWorkbenchLayoutSettings.diagramVisible,
      };
      this.#persistLayout();
    }
    if (previous.autoSave !== this.#editorSettings.autoSave) {
      for (const tab of this.#tabController.tabs()) {
        if (this.#editorSettings.autoSave === "afterDelay" && tab.dirty)
          this.#scheduleAutoSave(tab);
        else this.#saveController.cancelAutoSave(tab.path);
      }
    }
  }

  #scheduleAutoSave(tab: OpenTab): void {
    if (tab.readOnly || this.#editorSettings.autoSave !== "afterDelay") return;
    this.#saveController.scheduleAutoSave(tab);
  }

  #updateDiagramSettings(changes: Partial<DiagramSettings>): void {
    this.#diagramSettings = { ...this.#diagramSettings, ...changes };
    localStorage.setItem(
      diagramSettingsKey,
      JSON.stringify(this.#diagramSettings),
    );
    if (this.#diagramVisible) void this.#renderDiagram();
  }

  #renderScmPlaceholder(host: HTMLElement): void {
    host.append(
      Object.assign(document.createElement("p"), {
        className: "empty-view",
        textContent: "Initialize or clone a repository to use Source Control.",
      }),
    );
  }

  #renderTabs(): void {
    const host = this.#required("#tabs");
    host.replaceChildren();
    for (const tab of this.#tabController.tabs()) {
      const item = document.createElement("div");
      item.className = [
        "tab",
        tab.path === this.#activePath ? "active" : "",
        tab.dirty ? "dirty" : "",
      ]
        .filter(Boolean)
        .join(" ");
      item.addEventListener("auxclick", (event) => {
        if (event.button === 1) void this.#requestCloseTab(tab);
      });
      const label = document.createElement("button");
      label.className = "tab-label";
      label.title = tab.path;
      if (tab.readOnly) label.append(this.#icon("lock"));
      label.append(
        Object.assign(document.createElement("span"), {
          textContent: tab.label,
        }),
      );
      label.addEventListener("click", () => this.#activateTab(tab));
      const close = document.createElement("button");
      close.className = "tab-close";
      close.tabIndex = 0;
      if (tab.dirty) close.classList.add("dirty-close");
      close.setAttribute("aria-label", `Close ${tab.label}`);
      close.title = `Close ${tab.label}`;
      if (tab.dirty) close.append(this.#icon("close-dirty"));
      close.append(this.#icon("close"));
      close.addEventListener("click", () => void this.#requestCloseTab(tab));
      item.append(label, close);
      host.append(item);
    }
    this.#renderOpenEditors();
  }

  #activateTab(tab: OpenTab): void {
    if (this.#primary.getModel() !== tab.model)
      this.#primary.setModel(tab.model);
    if (this.#activePath !== tab.path) this.#reflectActiveTab(tab);
    this.#primary.focus();
  }

  #reflectActiveTab(tab: OpenTab): void {
    if (this.#activePath === tab.path) return;
    this.#cancelDeferredEditorRefreshes();
    this.#activePath = tab.path;
    this.#primary.updateOptions({ readOnly: tab.readOnly });
    if (this.#secondary) {
      this.#secondary.setModel(tab.model);
      this.#secondary.updateOptions({ readOnly: tab.readOnly });
    }
    this.#required("#breadcrumbs").textContent = tab.readOnly
      ? `Repository › ${tab.label}`
      : tab.path.split("/").filter(Boolean).join(" › ");
    this.#renderTabs();
    void this.#renderOutline();
  }

  #onModelChanged(tab: OpenTab): void {
    if (tab.readOnly) return;
    const becameDirty = updateDirtyState(tab, true);
    if (becameDirty) {
      this.#required("#result-status").textContent = "outdated — save or compile";
      this.#required("#compile-status").textContent = "INTERLIS: outdated";
      const saved = this.languageService.getSavedSemanticSnapshot(
        tab.model.uri.toString(),
      );
      if (saved?.value) this.#diagram.publish(saved.value, "stale");
      this.#renderTabs();
    }
    this.#recoveryController.schedule({
      path: tab.model.uri.toString(),
      model: tab.model,
    });
    this.#scheduleAutoSave(tab);
    if (tab.path === this.#activePath) this.#scheduleSuggestionRefresh();
    if (tab.path === this.#activePath && this.#activeView === "outline")
      this.#outlineRefresh.schedule(() => void this.#renderOutline());
  }

  #scheduleSuggestionRefresh(target: editor.ICodeEditor = this.#primary): void {
    const generation = this.#suggestionRequests.next();
    this.#suggestionRefresh.schedule(() => {
      void this.#refreshSuggestions(target, generation);
    });
  }

  #invalidateSuggestions(target: editor.ICodeEditor = this.#primary): void {
    this.#suggestionRequests.invalidate();
    this.#suggestionRefresh.cancel();
    target.trigger("interlis.suggestionLifecycle", "hideSuggestWidget", null);
  }

  #registerSnippetNavigation(): void {
    const snippetContext =
      "editorTextFocus && editorLangId == 'interlis' && inSnippetMode";
    const navigate = () => {
      this.#invalidateSuggestions();
      this.#primary.trigger(
        "interlis.snippetNavigation",
        "jumpToNextSnippetPlaceholder",
        null,
      );
      this.#scheduleSuggestionRefresh();
    };
    this.#primary.addCommand(
      monaco.KeyCode.Enter,
      navigate,
      `${snippetContext} && !suggestWidgetVisible`,
    );
    this.#primary.addCommand(
      monaco.KeyCode.Tab,
      navigate,
      `${snippetContext} && !suggestWidgetVisible`,
    );
  }

  async #refreshSuggestions(
    target: editor.ICodeEditor,
    generation: number,
  ): Promise<void> {
    const model = target.getModel();
    const position = target.getPosition();
    if (!model || !position) return;
    const tab = [...this.#tabController.tabs()].find(
      (candidate) => candidate.model === model,
    );
    if (!tab || tab.path !== this.#activePath) return;

    const version = model.getVersionId();
    const uri = model.uri.toString();
    const isCurrent = (): boolean => {
      const currentPosition = target.getPosition();
      return (
        this.#suggestionRequests.isCurrent(generation) &&
        target.getModel() === model &&
        model.getVersionId() === version &&
        currentPosition?.lineNumber === position.lineNumber &&
        currentPosition.column === position.column
      );
    };
    const hideOnce = (): void =>
      target.trigger("interlis.suggestionLifecycle", "hideSuggestWidget", null);
    const hide = (): void => {
      if (!isCurrent()) return;
      hideOnce();
      window.setTimeout(() => {
        if (isCurrent()) hideOnce();
      }, 0);
    };
    const activation = this.languageAdapter.suggestionActivation(
      model,
      position,
    );
    if (activation.suppress || activation.reason === "none") {
      hide();
      return;
    }
    if (!activation.open) {
      hide();
      return;
    }

    const items = await this.languageService.completion(uri, {
      line: position.lineNumber - 1,
      character: position.column - 1,
    });
    if (!isCurrent()) return;
    if (items.length === 0) hide();
    else {
      await Promise.resolve();
      if (!isCurrent()) return;
      target.trigger(
        "interlis.suggestionLifecycle",
        "editor.action.triggerSuggest",
        null,
      );
    }
  }

  async #syncWorkspaceSources(
    reason: WorkspaceFullSyncReason = "manual-refresh",
    path = "/",
  ): Promise<void> {
    const sources: Array<{ uri: string; text: string }> = [];
    await this.#collectWorkspaceSources(path, sources);
    this.#workspaceSourceSynchronizer.replaceAll(sources, reason);
  }

  async #collectWorkspaceSources(
    path: string,
    sources: Array<{ uri: string; text: string }>,
  ): Promise<void> {
    for (const [name, type] of await this.#workspace.readDirectory(path)) {
      if (name.startsWith(".")) continue;
      const child = normalizePath(`${path}/${name}`);
      if (type === "directory") {
        await this.#collectWorkspaceSources(child, sources);
        continue;
      }
      if (!name.toLowerCase().endsWith(".ili")) continue;
      sources.push({
        uri: this.#modelUri(child),
        text: fileText(await this.#workspace.read(child)),
      });
    }
  }

  #resetLanguageDocuments(): void {
    for (const document of [...this.languageService.documents])
      this.languageService.closeDocument(document.uri);
    this.#workspaceSourceSynchronizer.clear();
  }

  async #renderDiagram(): Promise<void> {
    const generation = ++this.#diagramGeneration;
    const host = this.#required("#diagram-host");
    this.#diagramInteractionController?.abort();
    this.#diagramInteractionController = null;
    const previous = host.querySelector<HTMLElement>(".diagram-viewport");
    if (previous && this.#diagramLayout) {
      const previousZoom = clampDiagramZoom(
        Number(previous.dataset.zoom ?? "1"),
      );
      const previousOffsetX = Number(previous.dataset.offsetX ?? "0");
      const previousOffsetY = Number(previous.dataset.offsetY ?? "0");
      this.#diagramViewport = captureViewport(this.#diagramLayout, {
        zoom: previousZoom,
        scrollX: (previous.scrollLeft - previousOffsetX) / previousZoom,
        scrollY: (previous.scrollTop - previousOffsetY) / previousZoom,
        width: Math.max(1, previous.clientWidth),
        height: Math.max(1, previous.clientHeight),
      });
    }
    const snapshot = this.#diagram.state.snapshot;
    if (!snapshot) {
      this.#renderDiagramStatus(this.#diagram.state.message);
      return;
    }
    try {
      const rendered = await layoutAndRenderDiagram(
        snapshot.diagram,
        this.#diagramSettings,
      );
      if (generation !== this.#diagramGeneration) return;
      this.#diagramLayout = rendered.layout;
      this.#diagramSvg = rendered.svg;
      host.innerHTML = `<header class="diagram-toolbar"><span class="diagram-status"></span><button data-command="diagram-refresh"><span class="codicon codicon-refresh" aria-hidden="true"></span>Auto-layout</button><button data-command="export-svg"><span class="codicon codicon-export" aria-hidden="true"></span>SVG</button><button data-command="export-docx"><span class="codicon codicon-file" aria-hidden="true"></span>DOCX</button><button data-command="diagram" aria-label="Close UML diagram" title="Close UML Diagram"><span class="codicon codicon-close" aria-hidden="true"></span></button></header><div class="diagram-viewport" tabindex="0" aria-label="Diagram viewport — hold Space and drag to pan" title="Hold Space and drag to pan"><div class="diagram-canvas">${rendered.svg}</div></div>`;
      const status = host.querySelector<HTMLElement>(".diagram-status");
      if (status) {
        status.textContent = this.#diagram.state.message;
        status.dataset.state = this.#diagram.state.status;
      }
      const viewport = host.querySelector<HTMLElement>(".diagram-viewport");
      const surface = viewport?.querySelector<HTMLElement>(".diagram-canvas");
      const diagram = viewport?.querySelector<SVGSVGElement>("svg");
      if (viewport && surface && diagram) {
        const restored: Viewport = this.#diagramViewport
          ? restoreViewport(rendered.layout, this.#diagramViewport, {
              width: Math.max(1, viewport.clientWidth),
              height: Math.max(1, viewport.clientHeight),
            })
          : {
              zoom: 1,
              scrollX: 0,
              scrollY: 0,
              width: Math.max(1, viewport.clientWidth),
              height: Math.max(1, viewport.clientHeight),
            };
        const viewBox = diagram.viewBox.baseVal;
        const baseWidth =
          viewBox.width || diagram.getBoundingClientRect().width || 1;
        const baseHeight =
          viewBox.height || diagram.getBoundingClientRect().height || 1;
        let zoom = clampDiagramZoom(restored.zoom);
        let diagramOffsetX = 0;
        let diagramOffsetY = 0;

        const syncSurface = (): void => {
          const scaledWidth = baseWidth * zoom;
          const scaledHeight = baseHeight * zoom;
          const availableWidth = Math.max(
            0,
            viewport.clientWidth - diagramPadding * 2,
          );
          const availableHeight = Math.max(
            0,
            viewport.clientHeight - diagramPadding * 2,
          );
          diagramOffsetX =
            diagramPadding + Math.max(0, (availableWidth - scaledWidth) / 2);
          diagramOffsetY =
            diagramPadding + Math.max(0, (availableHeight - scaledHeight) / 2);
          diagram.style.position = "absolute";
          diagram.style.left = `${diagramOffsetX}px`;
          diagram.style.top = `${diagramOffsetY}px`;
          diagram.style.width = `${scaledWidth}px`;
          diagram.style.height = `${scaledHeight}px`;
          surface.style.width = `${Math.max(
            scaledWidth + diagramPadding * 2,
            viewport.clientWidth,
          )}px`;
          surface.style.height = `${Math.max(
            scaledHeight + diagramPadding * 2,
            viewport.clientHeight,
          )}px`;
          viewport.dataset.zoom = String(zoom);
          viewport.dataset.offsetX = String(diagramOffsetX);
          viewport.dataset.offsetY = String(diagramOffsetY);
        };

        const setZoom = (
          next: number,
          cursorX = viewport.clientWidth / 2,
          cursorY = viewport.clientHeight / 2,
        ): void => {
          const target = clampDiagramZoom(next);
          if (target === zoom) return;
          const worldX =
            (viewport.scrollLeft + cursorX - diagramOffsetX) / zoom;
          const worldY = (viewport.scrollTop + cursorY - diagramOffsetY) / zoom;
          zoom = target;
          syncSurface();
          viewport.scrollLeft = worldX * zoom + diagramOffsetX - cursorX;
          viewport.scrollTop = worldY * zoom + diagramOffsetY - cursorY;
        };

        viewport.addEventListener(
          "wheel",
          (event) => {
            event.preventDefault();
            if (event.deltaY === 0) return;
            const bounds = viewport.getBoundingClientRect();
            setZoom(
              zoom *
                (event.deltaY < 0 ? diagramZoomFactor : 1 / diagramZoomFactor),
              event.clientX - bounds.left,
              event.clientY - bounds.top,
            );
          },
          { passive: false },
        );

        let panPointer = -1;
        let panStartX = 0;
        let panStartY = 0;
        let panScrollX = 0;
        let panScrollY = 0;
        let spacePressed = false;
        const interactionController = new AbortController();
        this.#diagramInteractionController = interactionController;
        const interactionSignal = interactionController.signal;
        const updateSpace = (event: KeyboardEvent): void => {
          if (event.code !== "Space") return;
          const overViewport =
            viewport.matches(":hover") || document.activeElement === viewport;
          if (event.type === "keydown" && !overViewport) return;
          spacePressed = event.type === "keydown";
          if (overViewport) event.preventDefault();
        };
        document.addEventListener("keydown", updateSpace, {
          signal: interactionSignal,
        });
        document.addEventListener("keyup", updateSpace, {
          signal: interactionSignal,
        });
        viewport.addEventListener(
          "pointerdown",
          (event) => {
            const panningButton =
              event.button === 1 || (event.button === 0 && spacePressed);
            if (!panningButton) {
              viewport.focus({ preventScroll: true });
              return;
            }
            event.preventDefault();
            viewport.focus({ preventScroll: true });
            panPointer = event.pointerId;
            panStartX = event.clientX;
            panStartY = event.clientY;
            panScrollX = viewport.scrollLeft;
            panScrollY = viewport.scrollTop;
            viewport.classList.add("is-panning");
            viewport.setPointerCapture(event.pointerId);
          },
          { signal: interactionSignal },
        );
        viewport.addEventListener(
          "pointermove",
          (event) => {
            if (event.pointerId !== panPointer) return;
            event.preventDefault();
            viewport.scrollLeft = panScrollX - (event.clientX - panStartX);
            viewport.scrollTop = panScrollY - (event.clientY - panStartY);
          },
          { signal: interactionSignal },
        );
        const stopPan = (event: PointerEvent): void => {
          if (event.pointerId !== panPointer) return;
          const pointer = panPointer;
          panPointer = -1;
          viewport.classList.remove("is-panning");
          if (
            event.type !== "lostpointercapture" &&
            viewport.hasPointerCapture(pointer)
          )
            viewport.releasePointerCapture(pointer);
        };
        viewport.addEventListener("pointerup", stopPan, {
          signal: interactionSignal,
        });
        viewport.addEventListener("pointercancel", stopPan, {
          signal: interactionSignal,
        });
        viewport.addEventListener("lostpointercapture", stopPan, {
          signal: interactionSignal,
        });
        viewport.addEventListener(
          "auxclick",
          (event) => {
            if (event.button === 1) event.preventDefault();
          },
          { signal: interactionSignal },
        );

        syncSurface();
        viewport.scrollTo(
          restored.scrollX * zoom + diagramOffsetX,
          restored.scrollY * zoom + diagramOffsetY,
        );
      }
      viewport?.addEventListener("dblclick", (event) => {
        const target =
          event.target instanceof Element
            ? event.target.closest<HTMLElement>("[data-symbol-id]")
            : null;
        if (target?.dataset.symbolId)
          void this.#navigateToDiagramNode(target.dataset.symbolId);
      });
    } catch (error) {
      this.#diagram.fail(
        error instanceof Error ? error.message : String(error),
      );
      this.#renderDiagramStatus(this.#diagram.state.message);
    }
  }

  #renderDiagramStatus(message: string): void {
    const host = this.#required("#diagram-host");
    host.innerHTML = `<header class="diagram-toolbar"><span class="diagram-status"></span><button data-command="diagram-refresh"><span class="codicon codicon-refresh" aria-hidden="true"></span>Retry</button><button data-command="diagram" aria-label="Close UML diagram" title="Close UML Diagram"><span class="codicon codicon-close" aria-hidden="true"></span></button></header><div class="diagram-empty"></div>`;
    const status = host.querySelector<HTMLElement>(".diagram-status");
    const empty = host.querySelector<HTMLElement>(".diagram-empty");
    if (status) {
      status.textContent = message;
      status.dataset.state = this.#diagram.state.status;
    }
    if (empty) empty.textContent = message;
  }

  #updateDiagramStatus(
    message: string,
    state: "empty" | "loading" | "ready" | "stale" | "error",
  ): boolean {
    const host = this.#required("#diagram-host");
    const status = host.querySelector<HTMLElement>(".diagram-status");
    if (!status || !host.querySelector(".diagram-viewport svg")) return false;
    status.textContent = message;
    status.dataset.state = state;
    return true;
  }

  async #navigateToDiagramNode(nodeId: string): Promise<void> {
    const snapshot = this.#diagram.state.snapshot;
    const range = snapshot ? sourceLocationForNode(snapshot, nodeId) : null;
    if (!range) return;
    if (this.languageService.getRepositoryDocument(range.uri)) {
      await this.openRepositoryModel(range.uri);
      const selection = {
        startLineNumber: range.start.line + 1,
        startColumn: range.start.character + 1,
        endLineNumber: range.end.line + 1,
        endColumn: range.end.character + 1,
      };
      this.#primary.setSelection(selection);
      this.#primary.revealRangeInCenter(selection);
      return;
    }
    let path: string;
    try {
      path = new URL(range.uri).pathname;
    } catch {
      return;
    }
    if (!(await this.#exists(path))) return;
    await this.openFile(path);
    const selection = {
      startLineNumber: range.start.line + 1,
      startColumn: range.start.character + 1,
      endLineNumber: range.end.line + 1,
      endColumn: range.end.character + 1,
    };
    this.#primary.setSelection(selection);
    this.#primary.revealRangeInCenter(selection);
    this.#primary.focus();
  }

  #modelUri(path: string): string {
    return `opfs://${this.manager.activeDescriptor?.id ?? "workspace"}${normalizePath(path)}`;
  }

  #activeDocumentUri(): string | undefined {
    return this.#activePath
      ? this.#tabController.byPath(this.#activePath)?.model.uri.toString()
      : undefined;
  }

  #activeBaseName(): string {
    return (
      this.#activePath
        ?.split("/")
        .at(-1)
        ?.replace(/\.ili$/iu, "") ?? "interlis-model"
    );
  }

  async #ensureInitialContent(): Promise<void> {
    const visible = (await this.#workspace.readDirectory("/")).filter(
      ([name]) => !name.startsWith("."),
    );
    if (visible.length === 0)
      await this.#workspace.write("/Model.ili", textFile(sampleModel));
  }

  async #openFirstInterlisFile(path = "/"): Promise<boolean> {
    for (const [name, type] of await this.#workspace.readDirectory(path)) {
      if (name.startsWith(".")) continue;
      const child = normalizePath(`${path}/${name}`);
      if (type === "directory") {
        if (await this.#openFirstInterlisFile(child)) return true;
      } else if (name.toLowerCase().endsWith(".ili")) {
        await this.openFile(child);
        return true;
      }
    }
    return false;
  }

  async #restoreRecovery(): Promise<void> {
    const buffers = await this.#recoveryController.list();
    const latest = buffers[0];
    if (!latest) return;
    const path = new URL(latest.uri).pathname;
    if (await this.#exists(path)) {
      await this.openFile(path);
      const tab = this.#tabController.byPath(path);
      if (tab && tab.model.getValue() !== latest.text) {
        tab.model.setValue(latest.text);
        this.#log(`Recovered unsaved changes for ${path}`);
      } else await this.#recoveryController.clear(latest.uri);
    }
  }

  #showCommandPalette(): void {
    const palette = this.#required("#quick-pick");
    const input = this.#required<HTMLInputElement>("#quick-input");
    const items = this.#required("#quick-items");
    const render = () => {
      items.replaceChildren();
      const query = input.value.replace(/^>/, "").trim().toLowerCase();
      const commands = this.#commandRegistry
        .list()
        .filter((candidate) => candidate.label.toLowerCase().includes(query))
        .sort((left, right) =>
          left.label.localeCompare(right.label, undefined, {
            sensitivity: "base",
          }),
        );
      for (const command of commands) {
        const button = document.createElement("button");
        button.textContent = command.label;
        button.addEventListener("click", () => {
          this.#hideQuickPick();
          void this.#commandRegistry.execute(command.id);
        });
        items.append(button);
      }
    };
    palette.setAttribute("aria-label", "Command palette");
    if (palette.matches(":popover-open")) palette.hidePopover();
    input.value = ">";
    input.oninput = render;
    input.onkeydown = null;
    render();
    palette.showPopover();
    input.focus();
  }

  #showWorkspacePicker(): void {
    const palette = this.#required("#quick-pick");
    const items = this.#required("#quick-items");
    const input = this.#required<HTMLInputElement>("#quick-input");
    palette.setAttribute("aria-label", "Workspace picker");
    if (palette.matches(":popover-open")) palette.hidePopover();
    input.value = "Switch workspace";
    input.oninput = null;
    input.onkeydown = null;
    items.replaceChildren();
    for (const descriptor of this.manager.workspaces) {
      const row = document.createElement("div");
      row.className = "workspace-row";
      const select = document.createElement("button");
      select.className = "workspace-select";
      select.textContent = descriptor.name;
      select.addEventListener("click", () => {
        void this.manager.activate(descriptor.id).then(async () => {
          this.#hideQuickPick();
          await this.#switchFileSystem(this.manager.activeFileSystem);
        });
      });
      const actions = document.createElement("span");
      actions.className = "workspace-actions";
      const rename = document.createElement("button");
      rename.className = "workspace-action";
      rename.setAttribute("aria-label", `Rename ${descriptor.name}`);
      rename.title = `Rename ${descriptor.name}`;
      rename.append(this.#icon("edit"));
      rename.addEventListener("click", () => {
        this.#hideQuickPick();
        void this.renameWorkspace(descriptor.id);
      });
      const remove = document.createElement("button");
      remove.className = "workspace-action";
      remove.setAttribute("aria-label", `Delete ${descriptor.name}`);
      remove.title = `Delete ${descriptor.name}`;
      remove.append(this.#icon("trash"));
      remove.disabled = this.manager.workspaces.length === 1;
      remove.addEventListener("click", () => {
        this.#hideQuickPick();
        void this.deleteWorkspace(descriptor.id);
      });
      actions.append(rename, remove);
      row.append(select, actions);
      items.append(row);
    }
    palette.showPopover();
    input.focus();
  }

  #hideQuickPick(): void {
    const palette = this.#required("#quick-pick");
    if (palette.matches(":popover-open")) palette.hidePopover();
  }

  private toggleSplit(): void {
    const host = this.#required("#editor-secondary");
    if (this.#secondary) {
      this.#secondary.dispose();
      this.#secondary = null;
      host.classList.add("hidden");
      this.#syncAuxiliaryLayout();
      if (this.#diagramVisible) void this.#renderDiagram();
      return;
    }
    this.#diagramVisible = false;
    this.#required("#diagram-host").classList.add("hidden");
    host.classList.remove("hidden");
    this.#secondary = monaco.editor.create(host, {
      model: this.#primary.getModel(),
      readOnly: this.#activePath
        ? (this.#tabController.byPath(this.#activePath)?.readOnly ?? false)
        : false,
      automaticLayout: true,
      theme: document.documentElement.classList.contains("light")
        ? "interlis-light"
        : "interlis-dark",
      fontSize: this.#editorSettings.fontSize,
      formatOnType: this.#editorSettings.formatOnType,
      minimap: { enabled: false },
      scrollbar: hiddenEditorScrollbars,
    });
    this.#syncAuxiliaryLayout();
  }

  private togglePanel(): void {
    const panel = this.#required("#panel");
    const hidden = panel.classList.toggle("hidden");
    this.#required(".editor-group").classList.toggle("panel-hidden", hidden);
    if (!hidden) this.#applyPanelHeight();
  }
  private toggleTheme(): void {
    const light = document.documentElement.classList.toggle("light");
    monaco.editor.setTheme(light ? "interlis-light" : "interlis-dark");
  }

  #bindResizers(): void {
    this.#bindSplitter(
      this.#required("#sidebar-resizer"),
      "vertical",
      1,
      () => this.#required(".sidebar").getBoundingClientRect().width,
      (value, commit) => this.#setSidebarWidth(value, commit),
    );
    this.#bindSplitter(
      this.#required("#auxiliary-resizer"),
      "vertical",
      -1,
      () =>
        this.#required(".auxiliary-pane:not(.hidden)").getBoundingClientRect()
          .width,
      (value, commit) => this.#setAuxiliaryWidth(value, commit),
    );
    this.#bindSplitter(
      this.#required("#panel-resizer"),
      "horizontal",
      -1,
      () => this.#required("#panel").getBoundingClientRect().height,
      (value, commit) => this.#setPanelHeight(value, commit),
    );
  }

  #bindSplitter(
    splitter: HTMLElement,
    orientation: "vertical" | "horizontal",
    direction: 1 | -1,
    readValue: () => number,
    applyValue: (value: number, commit: boolean) => void,
  ): void {
    let pointerId: number | null = null;
    let startCoordinate = 0;
    let startValue = 0;
    let currentValue = 0;
    const coordinate = (event: PointerEvent) =>
      orientation === "vertical" ? event.clientX : event.clientY;
    splitter.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || splitter.classList.contains("hidden")) return;
      event.preventDefault();
      pointerId = event.pointerId;
      startCoordinate = coordinate(event);
      startValue = readValue();
      currentValue = startValue;
      splitter.classList.add("dragging");
      splitter.setPointerCapture(event.pointerId);
    });
    splitter.addEventListener("pointermove", (event) => {
      if (pointerId !== event.pointerId) return;
      currentValue =
        startValue + (coordinate(event) - startCoordinate) * direction;
      applyValue(currentValue, false);
    });
    const finish = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;
      if (splitter.hasPointerCapture(event.pointerId))
        splitter.releasePointerCapture(event.pointerId);
      pointerId = null;
      splitter.classList.remove("dragging");
      applyValue(currentValue, true);
    };
    splitter.addEventListener("pointerup", finish);
    splitter.addEventListener("pointercancel", finish);
    splitter.addEventListener("keydown", (event) => {
      const negative = orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
      const positive = orientation === "vertical" ? "ArrowRight" : "ArrowDown";
      if (event.key !== negative && event.key !== positive) return;
      event.preventDefault();
      const coordinateDelta =
        (event.key === positive ? 1 : -1) * (event.shiftKey ? 50 : 10);
      applyValue(readValue() + coordinateDelta * direction, true);
    });
  }

  #applyLayoutSettings(): void {
    this.#setSidebarWidth(this.#layout.sidebarWidth, false);
    this.#applyAuxiliaryRatio();
    this.#setPanelHeight(this.#layout.panelHeight, false);
  }

  #setSidebarWidth(value: number, commit: boolean): void {
    const workbench = this.#required(".workbench");
    const activity = this.#required(".activitybar");
    const splitter = this.#required("#sidebar-resizer");
    const available =
      workbench.clientWidth - activity.clientWidth - splitter.offsetWidth;
    const width =
      available > 0
        ? clampSplitSize(value, available, 180, 400)
        : Math.max(0, value);
    this.#required(".ide-shell").style.setProperty(
      "--sidebar-width",
      `${width}px`,
    );
    splitter.setAttribute(
      "aria-valuenow",
      String(Math.round(available > 0 ? (width / available) * 100 : 0)),
    );
    if (commit) {
      this.#layout = { ...this.#layout, sidebarWidth: width };
      this.#persistLayout();
    }
    this.#applyAuxiliaryRatio();
  }

  #applyAuxiliaryRatio(): void {
    const grid = this.#required("#editor-grid");
    const splitter = this.#required("#auxiliary-resizer");
    const available = grid.clientWidth - splitter.offsetWidth;
    if (available <= 0) return;
    this.#setAuxiliaryWidth(this.#layout.auxiliaryRatio * available, false);
  }

  #setAuxiliaryWidth(value: number, commit: boolean): void {
    const grid = this.#required("#editor-grid");
    const splitter = this.#required("#auxiliary-resizer");
    const available = grid.clientWidth - splitter.offsetWidth;
    if (available <= 0) return;
    const width = clampSplitSize(value, available, 240, 320);
    this.#required(".ide-shell").style.setProperty(
      "--auxiliary-width",
      `${width}px`,
    );
    const ratio = width / available;
    splitter.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
    if (commit) {
      this.#layout = { ...this.#layout, auxiliaryRatio: ratio };
      this.#persistLayout();
    }
  }

  #applyPanelHeight(): void {
    this.#setPanelHeight(this.#layout.panelHeight, false);
  }

  #setPanelHeight(value: number, commit: boolean): void {
    const group = this.#required(".editor-group");
    const splitter = this.#required("#panel-resizer");
    const available = group.clientHeight - 35 - 22 - splitter.offsetHeight;
    const height =
      available > 0
        ? clampSplitSize(value, available, 96, 160)
        : Math.max(0, value);
    this.#required(".ide-shell").style.setProperty(
      "--panel-height",
      `${height}px`,
    );
    splitter.setAttribute(
      "aria-valuenow",
      String(Math.round(available > 0 ? (height / available) * 100 : 0)),
    );
    if (commit) {
      this.#layout = { ...this.#layout, panelHeight: height };
      this.#persistLayout();
    }
  }

  #syncAuxiliaryLayout(): void {
    const secondaryVisible = this.#secondary !== null;
    this.#diagramVisible = !secondaryVisible && this.#diagramPreferredVisible;
    this.#required("#editor-secondary").classList.toggle(
      "hidden",
      !secondaryVisible,
    );
    this.#required("#diagram-host").classList.toggle(
      "hidden",
      !this.#diagramVisible,
    );
    const hasAuxiliary = secondaryVisible || this.#diagramVisible;
    this.#required("#editor-grid").classList.toggle(
      "has-auxiliary",
      hasAuxiliary,
    );
    this.#required("#auxiliary-resizer").classList.toggle(
      "hidden",
      !hasAuxiliary,
    );
    if (hasAuxiliary) this.#applyAuxiliaryRatio();
  }

  #persistLayout(): void {
    const layout = this.#editorSettings.rememberDiagramVisibility
      ? this.#layout
      : {
          ...this.#layout,
          diagramVisible: defaultWorkbenchLayoutSettings.diagramVisible,
        };
    localStorage.setItem(layoutSettingsKey, JSON.stringify(layout));
  }

  #icon(name: string): HTMLSpanElement {
    const icon = document.createElement("span");
    icon.className = `codicon codicon-${name}`;
    icon.setAttribute("aria-hidden", "true");
    return icon;
  }

  #disposeTabs(): void {
    this.#cancelDeferredEditorRefreshes();
    this.#primary.setModel(null);
    this.#secondary?.setModel(null);
    for (const tab of this.#tabController.tabs()) {
      tab.language.dispose();
      tab.model.dispose();
    }
    this.#tabController.dispose();
    this.#saveController.cancelAll();
    this.#activePath = null;
    this.#renderTabs();
  }

  #cancelDeferredEditorRefreshes(): void {
    this.#suggestionRefresh.cancel();
    this.#suggestionRequests.invalidate();
    this.#outlineRefresh.cancel();
  }

  #configureInterlis(): void {
    monaco.editor.defineTheme("interlis-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "keyword", foreground: "C586C0", fontStyle: "bold" },
        { token: "comment", foreground: "6A9955" },
        { token: "string", foreground: "CE9178" },
        { token: "number", foreground: "B5CEA8" },
      ],
      colors: { "editor.background": "#1e1e1e" },
    });
    monaco.editor.defineTheme("interlis-light", {
      base: "vs",
      inherit: true,
      rules: [
        { token: "keyword", foreground: "AF00DB", fontStyle: "bold" },
        { token: "comment", foreground: "008000" },
        { token: "string", foreground: "A31515" },
        { token: "number", foreground: "098658" },
      ],
      colors: { "editor.background": "#ffffff" },
    });
    monaco.languages.register({
      id: "interlis",
      extensions: [".ili"],
      aliases: ["INTERLIS"],
    });
    monaco.languages.setLanguageConfiguration("interlis", {
      comments: { lineComment: "!!", blockComment: ["/*", "*/"] },
      brackets: [
        ["(", ")"],
        ["[", "]"],
        ["{", "}"],
      ],
      autoClosingPairs: [
        { open: "(", close: ")" },
        { open: "[", close: "]" },
        { open: '"', close: '"' },
        { open: "/*", close: "*/" },
      ],
      indentationRules: {
        increaseIndentPattern: /^.*=\s*$/,
        decreaseIndentPattern: /^\s*END\b.*$/,
      },
    });
    monaco.languages.setMonarchTokensProvider("interlis", {
      ignoreCase: true,
      keywords: [
        "INTERLIS",
        "MODEL",
        "TOPIC",
        "CLASS",
        "STRUCTURE",
        "ASSOCIATION",
        "DOMAIN",
        "UNIT",
        "END",
        "IMPORTS",
        "EXTENDS",
        "MANDATORY",
        "TEXT",
        "NUMERIC",
      ],
      tokenizer: {
        root: [
          [/!!.*$/, "comment"],
          [/\/\*/, "comment", "@comment"],
          [
            /[A-Za-z_][\w]*/,
            { cases: { "@keywords": "keyword", "@default": "identifier" } },
          ],
          [/\d+(?:\.\d+)?/, "number"],
          [/"[^"]*"/, "string"],
        ],
        comment: [
          [/[^*]+/, "comment"],
          [/\*\//, "comment", "@pop"],
          [/\*/, "comment"],
        ],
      },
    });
  }

  async #exists(path: string): Promise<boolean> {
    try {
      await this.#workspace.stat(path);
      return true;
    } catch {
      return false;
    }
  }
  #updateWorkspaceStatus(
    message = this.manager.activeDescriptor?.name ?? "Workspace",
  ): void {
    this.#required("#workspace-status").replaceChildren(
      this.#icon("folder"),
      document.createTextNode(message),
    );
  }
  #log(message: string): void {
    console.info(message);
    this.#required("#activity-status").textContent = message;
  }
  #required<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.host.querySelector<T>(selector);
    if (!element) throw new Error(`Missing workbench element ${selector}`);
    return element;
  }
}
