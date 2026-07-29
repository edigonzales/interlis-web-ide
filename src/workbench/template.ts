export const workbenchTemplate = `
  <div class="ide-shell">
    <header class="titlebar">
      <div class="brand">INTERLIS Web IDE</div>
      <nav class="menubar" aria-label="Application menu">
        <button data-command="new-file">New Model</button><button data-command="toggle-search">Search</button>
        <button data-command="command-palette">Commands…</button><button data-command="compile">Compile</button>
      </nav>
      <button class="command-center" data-command="command-palette"><span class="codicon codicon-search" aria-hidden="true"></span><span>Search / Command Palette</span></button>
      <div class="window-actions"><button data-command="theme" aria-label="Toggle color theme" title="Toggle color theme"><span class="codicon codicon-color-mode" aria-hidden="true"></span></button></div>
    </header>
    <div class="workbench">
      <nav class="activitybar" aria-label="Primary side bar">
        <button class="active" data-view="explorer" title="Explorer" aria-label="Explorer" aria-pressed="true"><span class="codicon codicon-files" aria-hidden="true"></span></button>
        <button data-view="search" title="Search" aria-label="Search" aria-pressed="false"><span class="codicon codicon-search" aria-hidden="true"></span></button>
        <button data-view="scm" title="Source Control" aria-label="Source Control" aria-pressed="false"><span class="codicon codicon-source-control" aria-hidden="true"></span></button>
        <button data-view="outline" title="Outline" aria-label="Outline" aria-pressed="false"><span class="codicon codicon-list-tree" aria-hidden="true"></span></button>
        <span class="activity-spacer"></span>
        <button data-view="settings" title="Settings" aria-label="Settings" aria-pressed="false"><span class="codicon codicon-settings-gear" aria-hidden="true"></span></button>
      </nav>
      <aside class="sidebar">
        <header><span id="sidebar-title">EXPLORER</span><span class="sidebar-actions"><button id="outline-collapse-all" class="hidden" data-command="outline-collapse-all" aria-label="Collapse all outline symbols" title="Collapse All"><span class="codicon codicon-collapse-all" aria-hidden="true"></span></button><button data-command="refresh" aria-label="Refresh side bar" title="Refresh"><span class="codicon codicon-refresh" aria-hidden="true"></span></button></span></header>
        <section id="sidebar-content"></section>
      </aside>
      <div id="sidebar-resizer" class="splitter splitter-vertical" role="separator" aria-label="Resize side bar" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="100" tabindex="0"></div>
      <main class="editor-group">
        <div class="tabs" id="tabs"></div>
        <div class="breadcrumbs" id="breadcrumbs">No file open</div>
        <div class="editor-grid" id="editor-grid"><div id="editor-primary" class="editor-host"></div><div id="auxiliary-resizer" class="splitter splitter-vertical hidden" role="separator" aria-label="Resize auxiliary editor" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="100" tabindex="0"></div><div id="editor-secondary" class="editor-host auxiliary-pane hidden"></div><section id="diagram-host" class="diagram-host auxiliary-pane hidden" aria-label="Live INTERLIS diagram"></section></div>
        <div id="panel-resizer" class="splitter splitter-horizontal" role="separator" aria-label="Resize panel" aria-orientation="horizontal" aria-valuemin="0" aria-valuemax="100" tabindex="0"></div>
        <section class="panel" id="panel">
          <header><button class="active" data-panel-view="problems">PROBLEMS <span id="problem-count" class="hidden"></span></button><button data-panel-view="output">OUTPUT</button><span id="result-status" class="panel-status">not compiled</span><button class="panel-action" data-command="toggle-panel" aria-label="Close panel" title="Close Panel"><span class="codicon codicon-close" aria-hidden="true"></span></button></header>
          <section id="problems" class="panel-content"><p class="panel-empty">No compilation result. Save or compile the active document.</p></section>
          <pre id="output" class="panel-content hidden">No compilation result. Save or compile the active document.</pre>
        </section>
      </main>
    </div>
    <footer class="statusbar">
      <button id="workspace-status" data-command="switch-workspace"><span class="codicon codicon-folder" aria-hidden="true"></span><span>Workspace</span></button>
      <span id="git-status">main*</span><span id="activity-status"></span><span class="status-spacer"></span>
      <span id="compile-status">INTERLIS: not compiled</span>
      <span id="cursor-status">Ln 1, Col 1</span><span>Spaces: 2</span><span>UTF-8</span><span>INTERLIS</span>
    </footer>
    <div class="quick-pick" id="quick-pick" role="dialog" aria-label="Command palette" popover="auto">
      <input id="quick-input" placeholder="> Type a command" />
      <div id="quick-items"></div>
    </div>
    <dialog class="close-editor-dialog" id="close-editor-dialog" aria-labelledby="close-editor-title" aria-describedby="close-editor-message">
      <form>
        <h2 id="close-editor-title">Save changes?</h2>
        <p id="close-editor-message"></p>
        <div class="dialog-actions">
          <button type="button" class="dialog-primary" data-close-action="save">Save</button>
          <button type="button" data-close-action="discard">Don't Save</button>
          <button type="button" data-close-action="cancel">Cancel</button>
        </div>
      </form>
    </dialog>
    <dialog class="close-editor-dialog" id="delete-file-dialog" aria-labelledby="delete-file-title" aria-describedby="delete-file-message">
      <form>
        <h2 id="delete-file-title">Delete file?</h2>
        <p id="delete-file-message"></p>
        <div class="dialog-actions">
          <button type="button" data-delete-file-action="cancel">Cancel</button>
          <button type="button" data-delete-file-action="delete">Delete</button>
          <button type="button" class="dialog-primary" data-delete-file-action="save-delete">Save &amp; Delete</button>
        </div>
      </form>
    </dialog>
    <dialog class="close-editor-dialog" id="delete-workspace-dialog" aria-labelledby="delete-workspace-title" aria-describedby="delete-workspace-message">
      <form>
        <h2 id="delete-workspace-title">Delete workspace?</h2>
        <p id="delete-workspace-message"></p>
        <div class="dialog-actions">
          <button type="button" data-delete-workspace-action="cancel">Cancel</button>
          <button type="button" class="dialog-primary" data-delete-workspace-action="delete">Delete Workspace</button>
        </div>
      </form>
    </dialog>
    <dialog class="close-editor-dialog" id="workspace-name-dialog" aria-labelledby="workspace-name-title">
      <form>
        <h2 id="workspace-name-title">Rename workspace</h2>
        <label class="dialog-field" for="workspace-name-input">Name</label>
        <input id="workspace-name-input" class="dialog-input" type="text" autocomplete="off" />
        <div class="dialog-actions">
          <button type="button" data-workspace-name-action="cancel">Cancel</button>
          <button type="submit" class="dialog-primary">Save</button>
        </div>
      </form>
    </dialog>
    <input id="zip-input" type="file" accept=".zip,application/zip" hidden />
  </div>
`;
