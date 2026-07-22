export const workbenchTemplate = `
  <div class="ide-shell">
    <header class="titlebar">
      <div class="brand">INTERLIS Web IDE</div>
      <nav class="menubar" aria-label="Application menu">
        <button data-command="new-file">File</button><button data-command="toggle-search">Edit</button>
        <button data-command="command-palette">View</button><button data-command="compile">Run</button>
      </nav>
      <button class="command-center" data-command="command-palette">⌕ Search / Command Palette</button>
      <div class="window-actions"><button data-command="theme">◐</button></div>
    </header>
    <div class="workbench">
      <nav class="activitybar" aria-label="Primary side bar">
        <button class="active" data-view="explorer" title="Explorer">▱</button>
        <button data-view="search" title="Search">⌕</button>
        <button data-view="scm" title="Source Control">⑂</button>
        <button data-view="outline" title="Outline">☷</button>
        <span class="activity-spacer"></span>
        <button data-view="settings" title="Settings">⚙</button>
      </nav>
      <aside class="sidebar">
        <header><span id="sidebar-title">EXPLORER</span><button data-command="refresh">↻</button></header>
        <section id="sidebar-content"></section>
      </aside>
      <main class="editor-group">
        <div class="tabs" id="tabs"></div>
        <div class="breadcrumbs" id="breadcrumbs">No file open</div>
        <div class="editor-grid"><div id="editor-primary" class="editor-host"></div><div id="editor-secondary" class="editor-host hidden"></div><section id="diagram-host" class="diagram-host hidden" aria-label="Live INTERLIS diagram"></section></div>
        <section class="panel" id="panel">
          <header><button class="active" data-panel-view="problems">PROBLEMS <span id="problem-count">0</span></button><button data-panel-view="output">OUTPUT</button><span id="result-status">not compiled</span><button data-command="toggle-panel">×</button></header>
          <section id="problems" class="panel-content"><p class="panel-empty">No compilation result. Save or compile the active document.</p></section>
          <pre id="output" class="panel-content hidden">No compilation result. Save or compile the active document.</pre>
        </section>
      </main>
    </div>
    <footer class="statusbar">
      <button id="workspace-status" data-command="switch-workspace">$(folder) Workspace</button>
      <span id="git-status">main*</span><span id="activity-status"></span><span class="status-spacer"></span>
      <span id="compile-status">INTERLIS: not compiled</span>
      <span id="cursor-status">Ln 1, Col 1</span><span>Spaces: 2</span><span>UTF-8</span><span>INTERLIS</span>
    </footer>
    <div class="quick-pick hidden" id="quick-pick" role="dialog" aria-label="Command palette">
      <input id="quick-input" placeholder="> Type a command" />
      <div id="quick-items"></div>
    </div>
    <input id="zip-input" type="file" accept=".zip,application/zip" hidden />
  </div>
`;
