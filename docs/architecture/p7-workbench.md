# P7 workbench boundaries

The WebIDE now has focused controller/view seams for command registration,
tabs, view rendering, save timers, recovery timers and problems ownership:

- `workbench/command-registry.ts`
- `workbench/workbench-view.ts`
- `workbench/tab-controller.ts`
- `workbench/save-controller.ts`
- `workbench/recovery-controller.ts`
- `workbench/problems-controller.ts`

`WebIdeWorkbench` uses `CommandRegistry` for command execution and has an
idempotent `dispose()` lifecycle. Existing UI behavior and E2E contracts are
preserved. The remaining large legacy workbench methods still need migration
into the controllers before the façade-size ratchet can be enabled strictly.
