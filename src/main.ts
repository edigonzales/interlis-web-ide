import "./style.css";
import { initializeVscodeServices } from "./vscode-services.js";
import { openOpfsRoot, WorkspaceManager } from "./workspace/index.js";
import { WebIdeWorkbench } from "./workbench/workbench.js";

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("Missing #app host element");

async function start(): Promise<void> {
  await initializeVscodeServices(app!);
  const opfs = await openOpfsRoot();
  const manager = new WorkspaceManager(opfs, window.sessionStorage);
  await manager.initialize();
  const workbench = new WebIdeWorkbench(app!, manager);
  await workbench.initialize();
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
