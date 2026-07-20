import type { WebIdeWorkbench } from "../workbench/workbench.js";
import { GitService, type GitIdentity } from "./service.js";

const defaultCloneUrl =
  "https://github.com/sogis/sogis-interlis-repository.git";
const defaultProxy = "https://cors.isomorphic-git.org";
const identityKey = "interlis-web-ide.git.identity";

function button(
  label: string,
  run: () => void | Promise<void>,
): HTMLButtonElement {
  const result = document.createElement("button");
  result.type = "button";
  result.textContent = label;
  result.addEventListener("click", () => void run());
  return result;
}

function input(
  placeholder: string,
  value = "",
  type = "text",
): HTMLInputElement {
  const result = document.createElement("input");
  result.placeholder = placeholder;
  result.value = value;
  result.type = type;
  return result;
}

export class GitPanel {
  #message = "";
  #diffText = "";

  constructor(
    private readonly workbench: WebIdeWorkbench,
    private readonly storage: Storage,
  ) {
    workbench.setSourceControlRenderer(() => this.render());
    workbench.onWorkspaceChanged(() => void this.refreshStatus());
  }

  async refreshStatus(service = this.service()): Promise<void> {
    if (!(await service.isRepository())) {
      this.workbench.setGitStatus("No Git");
      return;
    }
    const branch = (await service.currentBranch()) ?? "detached";
    const changes = await service.changes();
    this.workbench.setGitStatus(`${branch}${changes.length > 0 ? "*" : ""}`);
  }

  async render(): Promise<HTMLElement> {
    const host = document.createElement("div");
    host.className = "scm-view";
    const service = this.service();
    if (!(await service.isRepository())) this.renderSetup(host, service);
    else await this.renderRepository(host, service);
    if (this.#message) {
      const message = document.createElement("p");
      message.className = "scm-message";
      message.textContent = this.#message;
      host.append(message);
    }
    if (this.#diffText) {
      const diff = document.createElement("pre");
      diff.className = "scm-diff";
      diff.textContent = this.#diffText;
      host.append(diff);
    }
    return host;
  }

  private renderSetup(host: HTMLElement, service: GitService): void {
    const intro = document.createElement("p");
    intro.className = "empty-view";
    intro.textContent =
      "Initialize this workspace or shallow-clone a public HTTPS repository.";
    const initialize = button("Initialize Repository", () =>
      this.run(service, () => service.initialize(), "Repository initialized."),
    );
    initialize.className = "scm-primary";

    const url = input("Public HTTPS repository", defaultCloneUrl, "url");
    const proxy = input("CORS proxy", defaultProxy, "url");
    const clone = button("Clone Repository", async () => {
      if (
        !window.confirm("Clone replaces the current workspace files. Continue?")
      )
        return;
      await this.run(
        service,
        async () => {
          if (this.workbench.hasDirtyBuffers)
            throw new Error("Save or discard editor changes before cloning.");
          await service.clearForClone();
          await service.clone(url.value.trim(), proxy.value.trim());
          await this.workbench.reloadWorkspace();
        },
        "Repository cloned for offline work.",
      );
    });
    clone.className = "scm-primary";
    const form = document.createElement("div");
    form.className = "scm-form";
    form.append(url, proxy, clone);
    host.append(intro, initialize, form);
  }

  private async renderRepository(
    host: HTMLElement,
    service: GitService,
  ): Promise<void> {
    const [branch, branches, changes] = await Promise.all([
      service.currentBranch(),
      service.branches(),
      service.changes(),
    ]);
    this.workbench.setGitStatus(
      `${branch ?? "detached"}${changes.length > 0 ? "*" : ""}`,
    );
    const branchRow = document.createElement("div");
    branchRow.className = "scm-branch-row";
    const branchSelect = document.createElement("select");
    branchSelect.title = "Current branch";
    for (const name of branches) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      option.selected = name === branch;
      branchSelect.append(option);
    }
    branchSelect.addEventListener(
      "change",
      () =>
        void this.run(
          service,
          async () => {
            await service.checkout(branchSelect.value);
            await this.workbench.reloadWorkspace();
          },
          `Checked out ${branchSelect.value}.`,
        ),
    );
    const newBranch = input("New branch name");
    branchRow.append(
      branchSelect,
      newBranch,
      button("Create", () =>
        this.run(
          service,
          async () => {
            await service.createBranch(newBranch.value);
            await this.workbench.reloadWorkspace();
          },
          `Created ${newBranch.value}.`,
        ),
      ),
    );
    host.append(branchRow);

    const identity = this.loadIdentity();
    const message = input("Commit message");
    const name = input("Commit name", identity.name);
    const email = input("Commit email", identity.email, "email");
    const commit = button("Commit Staged Changes", () =>
      this.run(
        service,
        async () => {
          const author = { name: name.value, email: email.value };
          this.saveIdentity(author);
          const oid = await service.commit(message.value, author);
          this.#diffText = "";
          this.workbench.output.textContent += `\nCommitted ${oid.slice(0, 8)}: ${message.value.trim()}`;
        },
        "Changes committed locally.",
      ),
    );
    commit.className = "scm-primary";
    const commitForm = document.createElement("div");
    commitForm.className = "scm-form";
    commitForm.append(message, name, email, commit);
    host.append(commitForm);

    const heading = document.createElement("h3");
    heading.textContent = `Changes (${changes.length})`;
    host.append(heading);
    if (changes.length === 0) {
      const clean = document.createElement("p");
      clean.className = "empty-view";
      clean.textContent = "No local changes.";
      host.append(clean);
    }
    for (const change of changes) {
      const row = document.createElement("div");
      row.className = "scm-change";
      const code = document.createElement("span");
      code.className = `scm-code code-${change.code === "?" ? "new" : change.code.toLowerCase()}`;
      code.textContent = change.code;
      const path = document.createElement("span");
      path.className = "scm-path";
      path.textContent = change.filepath;
      row.append(code, path);
      if (change.unstaged)
        row.append(
          button("Stage", () =>
            this.run(
              service,
              () => service.stage(change.filepath),
              `Staged ${change.filepath}.`,
            ),
          ),
        );
      if (change.staged)
        row.append(
          button("Unstage", () =>
            this.run(
              service,
              () => service.unstage(change.filepath),
              `Unstaged ${change.filepath}.`,
            ),
          ),
        );
      row.append(
        button("Diff", async () => {
          this.#diffText = await service.diff(change.filepath);
          await this.workbench.renderSidebar();
        }),
      );
      host.append(row);
    }
  }

  private async run(
    service: GitService,
    operation: () => void | Promise<void>,
    success: string,
  ): Promise<void> {
    try {
      await operation();
      this.#message = success;
    } catch (error) {
      this.#message = error instanceof Error ? error.message : String(error);
    }
    await this.refreshStatus(service);
    await this.workbench.renderSidebar();
  }

  private service(): GitService {
    return new GitService(this.workbench.activeWorkspace);
  }

  private loadIdentity(): GitIdentity {
    try {
      const parsed = JSON.parse(this.storage.getItem(identityKey) ?? "{}") as {
        name?: unknown;
        email?: unknown;
      };
      return {
        name: typeof parsed.name === "string" ? parsed.name : "",
        email: typeof parsed.email === "string" ? parsed.email : "",
      };
    } catch {
      return { name: "", email: "" };
    }
  }

  private saveIdentity(identity: GitIdentity): void {
    this.storage.setItem(identityKey, JSON.stringify(identity));
  }
}
