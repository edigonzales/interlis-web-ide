import type { editor } from "monaco-editor";
import { monaco } from "../vscode-services.js";
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
  readonly model: editor.ITextModel;
  dirty: boolean;
  recoveryTimer: ReturnType<typeof setTimeout> | null;
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

export class WebIdeWorkbench {
  readonly #tabs = new Map<string, OpenTab>();
  readonly #handleStore = new DirectoryHandleStore();
  readonly #commands: Command[];
  #workspace: WorkspaceFileSystem;
  #recovery: BufferRecoveryStore;
  #primary!: editor.IStandaloneCodeEditor;
  #secondary: editor.IStandaloneCodeEditor | null = null;
  #activePath: string | null = null;
  #activeView = "explorer";

  constructor(
    private readonly host: HTMLElement,
    private readonly manager: WorkspaceManager,
  ) {
    this.#workspace = manager.activeFileSystem;
    this.#recovery = new BufferRecoveryStore(this.#workspace);
    this.#commands = [
      {
        id: "new-file",
        label: "File: New INTERLIS Model",
        run: () => this.newFile(),
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
    this.#bindUi();
    await this.#ensureInitialContent();
    await this.#restoreRecovery();
    if (!this.#activePath) await this.#openFirstInterlisFile();
    await this.renderSidebar();
    this.#updateWorkspaceStatus();
    this.#log("OPFS workspace and recovery services are ready.");
  }

  setSourceControlRenderer(
    renderer: () => HTMLElement | Promise<HTMLElement>,
  ): void {
    const command = this.host.querySelector<HTMLElement>('[data-view="scm"]');
    command?.addEventListener("click", () => {
      void Promise.resolve(renderer()).then((content) => {
        const host = this.#required("#sidebar-content");
        host.replaceChildren(content);
      });
    });
  }

  get activeWorkspace(): WorkspaceFileSystem {
    return this.#workspace;
  }
  get output(): HTMLElement {
    return this.#required("#output");
  }

  async openFile(path: string): Promise<void> {
    const normalized = normalizePath(path);
    let tab = this.#tabs.get(normalized);
    if (!tab) {
      const content = fileText(await this.#workspace.read(normalized));
      const uri = monaco.Uri.parse(
        `opfs://${this.manager.activeDescriptor?.id ?? "workspace"}${normalized}`,
      );
      const model =
        monaco.editor.getModel(uri) ??
        monaco.editor.createModel(content, "interlis", uri);
      tab = { path: normalized, model, dirty: false, recoveryTimer: null };
      this.#tabs.set(normalized, tab);
      model.onDidChangeContent(() => this.#onModelChanged(tab!));
    }
    this.#activePath = normalized;
    this.#primary.setModel(tab.model);
    if (this.#secondary) this.#secondary.setModel(tab.model);
    this.#renderTabs();
    this.#required("#breadcrumbs").textContent = normalized
      .split("/")
      .filter(Boolean)
      .join("  ›  ");
    this.#renderOutline();
  }

  async saveActive(): Promise<void> {
    if (!this.#activePath) return;
    const tab = this.#tabs.get(this.#activePath);
    if (!tab) return;
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
    const title = this.#required("#sidebar-title");
    const content = this.#required("#sidebar-content");
    title.textContent = this.#activeView.toUpperCase();
    content.replaceChildren();
    if (this.#activeView === "explorer") await this.#renderExplorer(content);
    else if (this.#activeView === "search") this.#renderSearch(content);
    else if (this.#activeView === "outline") this.#renderOutline(content);
    else if (this.#activeView === "settings") this.#renderSettings(content);
    else if (this.#activeView === "scm") this.#renderScmPlaceholder(content);
  }

  async newFile(): Promise<void> {
    let index = 1;
    let path = `/Untitled-${index}.ili`;
    while (await this.#exists(path)) path = `/Untitled-${++index}.ili`;
    await this.#workspace.write(path, textFile(sampleModel));
    await this.openFile(path);
    await this.renderSidebar();
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
    this.#workspace = workspace;
    this.#recovery = new BufferRecoveryStore(workspace);
    await this.#ensureInitialContent();
    await this.renderSidebar();
    this.#updateWorkspaceStatus();
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
    const values = [
      "Editor: Font Size 14",
      "Editor: Format On Type",
      "Diagram: Auto Open",
      "Files: Auto Save Off",
    ];
    host.append(
      heading,
      ...values.map((value) =>
        Object.assign(document.createElement("div"), {
          className: "setting-row",
          textContent: value,
        }),
      ),
    );
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
      button.textContent = `${tab.dirty ? "● " : ""}${tab.path.split("/").at(-1)}`;
      button.addEventListener("click", () => void this.openFile(tab.path));
      host.append(button);
    }
  }

  #onModelChanged(tab: OpenTab): void {
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
    this.#renderOutline();
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
    host.classList.remove("hidden");
    this.#secondary = monaco.editor.create(host, {
      model: this.#primary.getModel(),
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
