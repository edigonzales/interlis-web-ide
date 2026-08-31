# ADR 0001: Rein clientseitige Workspaces

Status: akzeptiert

Die IDE besitzt kein REST-Backend. OPFS ist das primäre Workspace-Dateisystem;
die File System Access API ist ein optionaler Chromium-Adapter. ZIP bildet den
portablen Fallback. Editor, Compiler und Git verwenden denselben
Dateisystemvertrag, damit Speichermodi nicht in Produktfunktionen hineinragen.
