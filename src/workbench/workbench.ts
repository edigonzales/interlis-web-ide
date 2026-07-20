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
} from "@ilic/diagram";
import { generateDocx } from "@ilic/docx";
import {
  OFFLINE_TEMPLATE,
  fetchTemplate,
  isBlankInterlisDocument,
  type LanguageService,
  type VersionedResult,
  type SemanticSnapshot,
} from "@ilic/language-service";
import type {
  Disposable as LanguageDisposable,
  MonacoLanguageAdapter,
} from "@ilic/monaco-adapter";
import { monaco } from "../vscode-services.js";
import {
  createBrowserModelRepository,
  defaultRepositorySetting,
  readRepositorySetting,
  repositorySettingsKey,
} from "../language-repository.js";
import {
  BufferRecoveryStore,
  DirectoryHandleStore,
  LocalFolderWorkspace,
  WorkspaceManager,
  downloadBytes,
  exportWorkspaceZip,
  fileText,
  importWorkspaceZip,
  normalizePath,
  textFile,
} from "../workspace/index.js";
import type {
  WorkspaceDescriptor,
  WorkspaceFileSystem,
} from "../workspace/index.js";
import { workbenchTemplate } from "./template.js";

interface OpenTab {
  readonly path: string;
  readonly label: string;
  readonly model: editor.ITextModel;
  readonly readOnly: boolean;
  dirty: boolean;
  recoveryTimer: ReturnType<typeof setTimeout> | null;
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
  readonly #tabs = new Map<string, OpenTab>();
  readonly #handleStore = new DirectoryHandleStore();
  readonly #commands: Command[];
  readonly #workspaceListeners = new Set<() => void>();
  readonly #diagram = new DiagramController();
  #workspace: WorkspaceFileSystem;
  #recovery: BufferRecoveryStore;
  #primary!: editor.IStandaloneCodeEditor;
  #secondary: editor.IStandaloneCodeEditor | null = null;
  #activePath: string | null = null;
  #activeView = "explorer";
  #sidebarGeneration = 0;
  #diagramGeneration = 0;
  #diagramLayout: LayoutDiagram | null = null;
  #diagramViewport: AnchoredViewport | null = null;
  #diagramSvg = "";
  #diagramVisible = true;
  #diagramSettings = readDiagramSettings();
  #sourceControlRenderer: (() => HTMLElement | Promise<HTMLElement>) | null =
    null;

  constructor(
    private readonly host: HTMLElement,
    private readonly manager: WorkspaceManager,
    private readonly languageService: LanguageService,
    private readonly languageAdapter: MonacoLanguageAdapter,
  ) {
    this.#workspace = manager.activeFileSystem;
    this.#recovery = new BufferRecoveryStore(this.#workspace);
    this.#commands = [
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
      {
        id: "new-from-offline-template",
        label: "INTERLIS: New Model from Offline Template",
        run: () => this.newFile(OFFLINE_TEMPLATE),
      },
      { id: "save", label: "File: Save", run: () => this.saveActive() },
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
        label: "INTERLIS: Show Live Diagram",
        run: () => this.showDiagram(),
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
    ];
  }

  async initialize(): Promise<void> {
    this.host.innerHTML = workbenchTemplate;
    this.#configureInterlis();
    const editorHost = this.#required<HTMLElement>("#editor-primary");
    this.#primary = monaco.editor.create(editorHost, {
      automaticLayout: true,
      theme: "interlis-dark",
      fontSize: 14,
      lineHeight: 21,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      glyphMargin: true,
      tabSize: 2,
    });
    this.#primary.onDidChangeCursorPosition((event) => {
      this.#required("#cursor-status").textContent =
        `Ln ${event.position.lineNumber}, Col ${event.position.column}`;
    });
    this.#primary.onDidChangeModel(() => {
      const model = this.#primary.getModel();
      const tab = model
        ? [...this.#tabs.values()].find(
            (candidate) => candidate.model === model,
          )
        : undefined;
      if (tab && tab.path !== this.#activePath) this.#reflectActiveTab(tab);
    });
    monaco.editor.registerEditorOpener({
      openCodeEditor: (_source, resource, selectionOrPosition) => {
        const tab = this.#tabs.get(resource.toString());
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
    await this.#ensureInitialContent();
    await this.#syncWorkspaceSources();
    await this.#restoreRecovery();
    if (!this.#activePath) await this.#openFirstInterlisFile();
    await this.renderSidebar();
    this.#updateWorkspaceStatus();
    this.#log("OPFS workspace and recovery services are ready.");
    this.#required("#diagram-host").classList.remove("hidden");
    this.#renderDiagramStatus("Analyzing the current workspace…");
  }

  async publishAnalysis(
    result: VersionedResult<SemanticSnapshot>,
  ): Promise<void> {
    if (!result.value) return;
    this.#diagram.publish(
      result.value,
      result.freshness === "fresh" ? "fresh" : "stale",
    );
    if (this.#diagramVisible) await this.#renderDiagram();
  }

  logError(operation: string, error: unknown): void {
    console.error(`${operation} failed`, error);
    this.#log(
      `${operation} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
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
  get hasDirtyBuffers(): boolean {
    return [...this.#tabs.values()].some((tab) => !tab.readOnly && tab.dirty);
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
    let tab = this.#tabs.get(normalized);
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
        recoveryTimer: null,
        language: this.languageAdapter.attachModel(model),
      };
      this.#tabs.set(normalized, tab);
      model.onDidChangeContent(() => this.#onModelChanged(tab!));
    }
    this.#activateTab(tab);
  }

  ensureRepositoryModel(uri: string): Promise<void> {
    const document = this.languageService.getRepositoryDocument(uri);
    if (!document) return Promise.resolve();
    this.languageService.prepareRepositoryDocument(uri);
    let tab = this.#tabs.get(uri);
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
        recoveryTimer: null,
        language: this.languageAdapter.attachModel(model, { readOnly: true }),
      };
      this.#tabs.set(uri, tab);
      this.#renderTabs();
    }
    return Promise.resolve();
  }

  async openRepositoryModel(uri: string): Promise<void> {
    await this.ensureRepositoryModel(uri);
    const tab = this.#tabs.get(uri);
    if (tab) this.#activateTab(tab);
  }

  async saveActive(): Promise<void> {
    if (!this.#activePath) return;
    const tab = this.#tabs.get(this.#activePath);
    if (!tab || tab.readOnly) {
      if (tab?.readOnly) this.#log("Repository models are read-only.");
      return;
    }
    await this.#workspace.write(tab.path, textFile(tab.model.getValue()), {
      create: true,
      overwrite: true,
    });
    tab.dirty = false;
    await this.#recovery.clear(tab.model.uri.toString());
    this.#renderTabs();
    this.#log(`Saved ${tab.path}`);
    await this.renderSidebar();
  }

  async renderSidebar(): Promise<void> {
    const generation = ++this.#sidebarGeneration;
    const activeView = this.#activeView;
    const title = this.#required("#sidebar-title");
    const content = this.#required("#sidebar-content");
    const next = document.createElement("div");
    if (activeView === "explorer") await this.#renderExplorer(next);
    else if (activeView === "search") this.#renderSearch(next);
    else if (activeView === "outline") this.#renderOutline(next);
    else if (activeView === "settings") this.#renderSettings(next);
    else if (activeView === "scm") {
      if (this.#sourceControlRenderer)
        next.append(await this.#sourceControlRenderer());
      else this.#renderScmPlaceholder(next);
    }
    if (generation !== this.#sidebarGeneration) return;
    title.textContent = activeView.toUpperCase();
    content.replaceChildren(...next.childNodes);
  }

  async newFile(content = sampleModel): Promise<void> {
    let index = 1;
    let path = `/Untitled-${index}.ili`;
    while (await this.#exists(path)) path = `/Untitled-${++index}.ili`;
    await this.#workspace.write(path, textFile(""));
    await this.openFile(path);
    this.#tabs.get(path)?.model.setValue(content);
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
    const active = this.#activePath ? this.#tabs.get(this.#activePath) : null;
    if (!active || isBlankInterlisDocument(active.model.getValue())) {
      this.#log("Compile skipped: the active INTERLIS document is blank.");
      return;
    }
    await this.#syncWorkspaceSources();
    const result = await this.languageService.compile();
    this.#required("#problem-count").textContent = String(result.errorCount);
    this.#log(
      `Compile ${result.success ? "succeeded" : "failed"}: ${result.errorCount} error(s), ${result.warningCount} warning(s).`,
    );
    for (const diagnostic of result.diagnostics)
      this.#log(
        `${diagnostic.severity.toUpperCase()} ${diagnostic.code}: ${diagnostic.message}`,
      );
    for (const entry of result.logs)
      this.#log(
        `${entry.level.toUpperCase()} [${entry.category}] ${entry.message}`,
      );
  }

  async showDiagram(force = false): Promise<void> {
    this.#diagramVisible = true;
    if (this.#secondary) {
      this.#secondary.dispose();
      this.#secondary = null;
      this.#required("#editor-secondary").classList.add("hidden");
    }
    this.#required("#diagram-host").classList.remove("hidden");
    this.#renderDiagramStatus("Updating diagram…");
    if (force || !this.languageService.getSemanticSnapshot()?.value)
      await this.languageService.analyzeNow(this.#activeDocumentUri());
    await this.#renderDiagram();
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
    let result = this.languageService.getSemanticSnapshot();
    if (!result?.value) result = await this.languageService.analyzeNow();
    const snapshot = result.value;
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

  private pickZip(): void {
    this.#required<HTMLInputElement>("#zip-input").click();
  }

  async #switchFileSystem(workspace: WorkspaceFileSystem): Promise<void> {
    this.#disposeTabs();
    this.#resetLanguageDocuments();
    this.#workspace = workspace;
    this.#recovery = new BufferRecoveryStore(workspace);
    await this.#ensureInitialContent();
    await this.#syncWorkspaceSources();
    await this.#openFirstInterlisFile();
    await this.renderSidebar();
    this.#updateWorkspaceStatus();
    for (const listener of this.#workspaceListeners) listener();
  }

  #bindUi(): void {
    this.host.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-command],[data-view]",
      );
      if (!target) return;
      const view = target.dataset.view;
      if (view) {
        this.#activeView = view;
        for (const button of this.host.querySelectorAll("[data-view]"))
          button.classList.toggle("active", button === target);
        void this.renderSidebar();
      }
      const command = target.dataset.command;
      if (command === "command-palette") this.#showCommandPalette();
      else if (command === "toggle-search") {
        this.#activeView = "search";
        void this.renderSidebar();
      } else if (command === "switch-workspace") this.#showWorkspacePicker();
      else {
        const selected = this.#commands.find(
          (candidate) => candidate.id === command,
        );
        if (selected) void selected.run();
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
          await this.#syncWorkspaceSources();
          this.#log(`Imported ${imported.length} file(s) from ZIP.`);
          await this.renderSidebar();
        });
      },
    );
    window.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void this.saveActive();
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
  }

  async #renderExplorer(host: HTMLElement): Promise<void> {
    const toolbar = document.createElement("div");
    toolbar.className = "sidebar-toolbar";
    const toolbarCommands: Array<[string, string]> = [
      ["New file", "new-file"],
      ["Open folder", "open-folder"],
      ["Import ZIP", "import-zip"],
      ["Export ZIP", "export-zip"],
    ];
    for (const [label, command] of toolbarCommands) {
      const button = document.createElement("button");
      button.textContent = label;
      button.dataset.command = command;
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
      const row = document.createElement("button");
      row.className = `file-row ${type}`;
      row.style.paddingLeft = `${8 + depth * 14}px`;
      row.textContent = `${type === "directory" ? "▾" : name.endsWith(".ili") ? "◇" : "·"} ${name}`;
      if (type === "file")
        row.addEventListener("click", () => void this.openFile(child));
      host.append(row);
      if (type === "directory")
        await this.#appendDirectory(host, child, depth + 1);
    }
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

  #renderOutline(host = this.#required("#sidebar-content")): void {
    if (this.#activeView !== "outline") return;
    host.replaceChildren();
    const model = this.#primary?.getModel();
    if (!model) return;
    const pattern =
      /^\s*(MODEL|TOPIC|CLASS|STRUCTURE|ASSOCIATION|DOMAIN|UNIT)\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
    for (const match of model.getValue().matchAll(pattern)) {
      const row = document.createElement("button");
      row.className = "outline-row";
      row.textContent = `${match[1]}  ${match[2]}`;
      host.append(row);
    }
  }

  #renderSettings(host: HTMLElement): void {
    const heading = document.createElement("h3");
    heading.textContent = "Settings";
    host.append(heading);
    const repositories = document.createElement("textarea");
    repositories.setAttribute("aria-label", "Model repositories");
    repositories.rows = 3;
    repositories.value = readRepositorySetting();
    repositories.placeholder = defaultRepositorySetting;
    repositories.addEventListener("change", () => {
      const value = repositories.value.trim() || defaultRepositorySetting;
      repositories.value = value;
      localStorage.setItem(repositorySettingsKey, value);
      void this.languageService
        .setModelRepository(
          createBrowserModelRepository(value, (message) =>
            this.logError("Model repository", message),
          ),
        )
        .then(() => this.languageService.analyzeNow(this.#activeDocumentUri()));
    });
    host.append(this.#settingRow("INTERLIS model repositories", repositories));
    host.append(
      Object.assign(document.createElement("p"), {
        className: "setting-help",
        textContent:
          "%ILI_DIR uses this workspace. Browser requests for models.interlis.ch and models.geo.admin.ch temporarily use the CORS mirrors at geo.so.ch.",
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
    host.append(this.#settingRow("Diagram: Edge routing", routing));

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
    host.append(this.#settingRow("Diagram: Attributes", attributes));

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
      host.append(this.#settingRow(`Diagram: ${label}`, input));
    }
    for (const value of [
      "Editor: Font Size 14",
      "Editor: Format On Type",
      "Diagram: Auto Open",
      "Files: Auto Save Off",
    ]) {
      host.append(
        Object.assign(document.createElement("div"), {
          className: "setting-row",
          textContent: value,
        }),
      );
    }
  }

  #settingRow(label: string, control: HTMLElement): HTMLElement {
    const row = document.createElement("label");
    row.className = "setting-row setting-control";
    row.append(document.createTextNode(label), control);
    return row;
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
    for (const tab of this.#tabs.values()) {
      const button = document.createElement("button");
      button.className = tab.path === this.#activePath ? "tab active" : "tab";
      button.textContent = `${tab.dirty ? "● " : ""}${tab.readOnly ? "🔒 " : ""}${tab.label}`;
      button.addEventListener("click", () => this.#activateTab(tab));
      host.append(button);
    }
  }

  #activateTab(tab: OpenTab): void {
    if (this.#primary.getModel() !== tab.model)
      this.#primary.setModel(tab.model);
    this.#reflectActiveTab(tab);
    this.#primary.focus();
  }

  #reflectActiveTab(tab: OpenTab): void {
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
    this.#renderOutline();
  }

  #onModelChanged(tab: OpenTab): void {
    if (tab.readOnly) return;
    tab.dirty = true;
    this.#renderTabs();
    if (tab.recoveryTimer) clearTimeout(tab.recoveryTimer);
    tab.recoveryTimer = setTimeout(() => {
      tab.recoveryTimer = null;
      void this.#recovery.save(
        tab.model.uri.toString(),
        tab.model.getVersionId(),
        tab.model.getValue(),
      );
    }, 250);
    if (tab.path === this.#activePath) {
      const position = this.#primary.getPosition();
      if (position) {
        const activation = this.languageAdapter.suggestionActivation(
          tab.model,
          position,
        );
        if (activation.open)
          this.#primary.trigger(
            "interlis.suggestionActivation",
            "editor.action.triggerSuggest",
            null,
          );
        else if (activation.suppress)
          this.#primary.trigger(
            "interlis.suggestionActivation",
            "hideSuggestWidget",
            null,
          );
      }
    }
    this.#renderOutline();
  }

  async #syncWorkspaceSources(path = "/"): Promise<void> {
    const sources: Array<{ uri: string; text: string }> = [];
    await this.#collectWorkspaceSources(path, sources);
    this.languageService.replaceWorkspaceSources(sources);
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
    this.languageService.replaceWorkspaceSources([]);
  }

  async #renderDiagram(): Promise<void> {
    const generation = ++this.#diagramGeneration;
    const host = this.#required("#diagram-host");
    const previous = host.querySelector<HTMLElement>(".diagram-viewport");
    if (previous && this.#diagramLayout) {
      this.#diagramViewport = captureViewport(this.#diagramLayout, {
        zoom: 1,
        scrollX: previous.scrollLeft,
        scrollY: previous.scrollTop,
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
      host.innerHTML = `<header class="diagram-toolbar"><span class="diagram-status"></span><button data-command="diagram-refresh">Auto-layout</button><button data-command="export-svg">SVG</button><button data-command="export-docx">DOCX</button></header><div class="diagram-viewport">${rendered.svg}</div>`;
      const status = host.querySelector<HTMLElement>(".diagram-status");
      if (status) {
        status.textContent = this.#diagram.state.message;
        status.dataset.state = this.#diagram.state.status;
      }
      const viewport = host.querySelector<HTMLElement>(".diagram-viewport");
      if (viewport && this.#diagramViewport) {
        const restored = restoreViewport(
          rendered.layout,
          this.#diagramViewport,
          {
            width: Math.max(1, viewport.clientWidth),
            height: Math.max(1, viewport.clientHeight),
          },
        );
        viewport.scrollTo(restored.scrollX, restored.scrollY);
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
    host.innerHTML = `<header class="diagram-toolbar"><span class="diagram-status"></span><button data-command="diagram-refresh">Retry</button></header><div class="diagram-empty"></div>`;
    const status = host.querySelector<HTMLElement>(".diagram-status");
    const empty = host.querySelector<HTMLElement>(".diagram-empty");
    if (status) status.textContent = message;
    if (empty) empty.textContent = message;
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
      ? this.#tabs.get(this.#activePath)?.model.uri.toString()
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
    const buffers = await this.#recovery.list();
    const latest = buffers[0];
    if (!latest) return;
    const path = new URL(latest.uri).pathname;
    if (await this.#exists(path)) {
      await this.openFile(path);
      const tab = this.#tabs.get(path);
      tab?.model.setValue(latest.text);
      this.#log(`Recovered unsaved changes for ${path}`);
    }
  }

  #showCommandPalette(): void {
    const palette = this.#required("#quick-pick");
    const input = this.#required<HTMLInputElement>("#quick-input");
    const items = this.#required("#quick-items");
    const render = () => {
      items.replaceChildren();
      for (const command of this.#commands.filter((candidate) =>
        candidate.label
          .toLowerCase()
          .includes(input.value.replace(/^>/, "").trim().toLowerCase()),
      )) {
        const button = document.createElement("button");
        button.textContent = command.label;
        button.addEventListener("click", () => {
          palette.classList.add("hidden");
          void command.run();
        });
        items.append(button);
      }
    };
    palette.classList.remove("hidden");
    input.value = ">";
    input.oninput = render;
    input.onkeydown = (event) => {
      if (event.key === "Escape") palette.classList.add("hidden");
    };
    render();
    input.focus();
  }

  #showWorkspacePicker(): void {
    const palette = this.#required("#quick-pick");
    const items = this.#required("#quick-items");
    const input = this.#required<HTMLInputElement>("#quick-input");
    palette.classList.remove("hidden");
    input.value = "Switch workspace";
    items.replaceChildren();
    for (const descriptor of this.manager.workspaces) {
      const button = document.createElement("button");
      button.textContent = descriptor.name;
      button.addEventListener("click", () => {
        void this.manager.activate(descriptor.id).then(async () => {
          palette.classList.add("hidden");
          await this.#switchFileSystem(this.manager.activeFileSystem);
        });
      });
      items.append(button);
    }
  }

  private toggleSplit(): void {
    const host = this.#required("#editor-secondary");
    if (this.#secondary) {
      this.#secondary.dispose();
      this.#secondary = null;
      host.classList.add("hidden");
      return;
    }
    this.#diagramVisible = false;
    this.#required("#diagram-host").classList.add("hidden");
    host.classList.remove("hidden");
    this.#secondary = monaco.editor.create(host, {
      model: this.#primary.getModel(),
      readOnly: this.#activePath
        ? (this.#tabs.get(this.#activePath)?.readOnly ?? false)
        : false,
      automaticLayout: true,
      theme: document.documentElement.classList.contains("light")
        ? "interlis-light"
        : "interlis-dark",
      minimap: { enabled: false },
    });
  }

  private togglePanel(): void {
    this.#required("#panel").classList.toggle("hidden");
  }
  private toggleTheme(): void {
    const light = document.documentElement.classList.toggle("light");
    monaco.editor.setTheme(light ? "interlis-light" : "interlis-dark");
  }

  #disposeTabs(): void {
    this.#primary.setModel(null);
    this.#secondary?.setModel(null);
    for (const tab of this.#tabs.values()) {
      if (tab.recoveryTimer) clearTimeout(tab.recoveryTimer);
      tab.language.dispose();
      tab.model.dispose();
    }
    this.#tabs.clear();
    this.#activePath = null;
    this.#renderTabs();
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
    this.#required("#workspace-status").textContent = `▱ ${message}`;
  }
  #log(message: string): void {
    this.output.textContent += `\n[${new Date().toLocaleTimeString()}] ${message}`;
    this.output.scrollTop = this.output.scrollHeight;
  }
  #required<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.host.querySelector<T>(selector);
    if (!element) throw new Error(`Missing workbench element ${selector}`);
    return element;
  }
}
