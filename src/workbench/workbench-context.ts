import type { LanguageService } from "@ilic/language-service";
import type { MonacoLanguageAdapter } from "@ilic/monaco-adapter";
import type { WorkspaceManager } from "../workspace/manager.js";
import type { WorkspaceFileSystem } from "../workspace/types.js";

export interface WorkbenchContext {
  readonly host: HTMLElement;
  readonly manager: WorkspaceManager;
  readonly languageService: LanguageService;
  readonly languageAdapter: MonacoLanguageAdapter;
  workspace: WorkspaceFileSystem;
}
