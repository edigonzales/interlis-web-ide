import "./style.css";
import { registerSW } from "virtual:pwa-register";
import {
  LanguageService,
  createWasmCompilerBackend,
} from "@ilic/language-service";
import { registerInterlisMonaco } from "@ilic/monaco-adapter";
import { GitPanel } from "./git/index.js";
import { initializeVscodeServices, monaco } from "./vscode-services.js";
import { openOpfsRoot, WorkspaceManager } from "./workspace/index.js";
import { WebIdeWorkbench } from "./workbench/workbench.js";

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("Missing #app host element");

async function start(): Promise<void> {
  app!.textContent = "Starting INTERLIS workbench…";
  await initializeVscodeServices(app!);
  app!.textContent = "Loading INTERLIS compiler…";
  const compiler = await createWasmCompilerBackend();
  const workbenchRef: { current?: WebIdeWorkbench } = {};
  const languageService = new LanguageService(compiler, {
    onAnalysis: ({ result }) =>
      void workbenchRef.current?.publishAnalysis(result),
    onError: (error) =>
      workbenchRef.current?.logError("Semantic analysis", error),
  });
  const languageAdapter = registerInterlisMonaco(monaco, languageService);
  app!.textContent = "Opening browser workspace…";
  const opfs = await openOpfsRoot();
  const manager = new WorkspaceManager(opfs, window.sessionStorage);
  await manager.initialize();
  const workbench = new WebIdeWorkbench(
    app!,
    manager,
    languageService,
    languageAdapter,
  );
  workbenchRef.current = workbench;
  await workbench.initialize();
  const sourceControl = new GitPanel(workbench, window.localStorage);
  await sourceControl.refreshStatus();
  registerSW({
    immediate: true,
    onOfflineReady: () => {
      workbench.output.textContent +=
        "\nINTERLIS Web IDE is cached and ready for offline use.";
    },
    onRegisterError: (error) => {
      workbench.output.textContent += `\nOffline cache registration failed: ${String(error)}`;
    },
  });
  window.addEventListener(
    "beforeunload",
    () => {
      languageAdapter.dispose();
      languageService.dispose();
    },
    { once: true },
  );
}

start().catch((error: unknown) => {
  app.innerHTML = `<section class="startup-error"><h1>INTERLIS Web IDE could not start</h1><p></p><button>Retry</button></section>`;
  const message = app.querySelector("p");
  if (message)
    message.textContent =
      error instanceof Error ? error.message : String(error);
  app
    .querySelector("button")
    ?.addEventListener("click", () => location.reload());
  console.error(error);
});
