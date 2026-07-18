import { Buffer } from "buffer";
import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import type { WorkspaceFileSystem } from "../workspace/index.js";
import { fileText, normalizePath } from "../workspace/index.js";
import { IsoGitFileSystemAdapter } from "./fs-adapter.js";

export interface GitIdentity {
  readonly name: string;
  readonly email: string;
}

export interface GitChange {
  readonly filepath: string;
  readonly code: "A" | "D" | "M" | "?";
  readonly staged: boolean;
  readonly unstaged: boolean;
}

const internalPaths = [".git/", ".interlis/", ".recovery/"];

// isomorphic-git's pack stream reader still expects the Node Buffer global.
// Keep the polyfill at this browser boundary instead of leaking it into the
// workspace or language-service contracts.
globalThis.Buffer ??= Buffer;

export class GitService {
  readonly #adapter: IsoGitFileSystemAdapter;
  readonly #dir = "/";

  constructor(private readonly workspace: WorkspaceFileSystem) {
    this.#adapter = new IsoGitFileSystemAdapter(workspace);
  }

  async isRepository(): Promise<boolean> {
    try {
      return (await this.workspace.stat("/.git")).type === "directory";
    } catch {
      return false;
    }
  }

  async initialize(defaultBranch = "main"): Promise<void> {
    await git.init({
      fs: this.#adapter.client,
      dir: this.#dir,
      defaultBranch,
    });
  }

  async clone(
    url: string,
    corsProxy = "https://cors.isomorphic-git.org",
  ): Promise<void> {
    if (!/^https:\/\//u.test(url))
      throw new Error("Only public HTTPS repositories can be cloned.");
    await git.clone({
      fs: this.#adapter.client,
      http,
      dir: this.#dir,
      url,
      corsProxy,
      depth: 1,
      singleBranch: true,
      noCheckout: false,
    });
  }

  async clearForClone(): Promise<void> {
    for (const [name] of await this.workspace.readDirectory("/")) {
      if (name === ".interlis" || name === ".recovery") continue;
      await this.workspace.delete(normalizePath(`/${name}`), {
        recursive: true,
      });
    }
  }

  async changes(): Promise<GitChange[]> {
    const matrix = await git.statusMatrix({
      fs: this.#adapter.client,
      dir: this.#dir,
    });
    return matrix
      .filter(
        ([filepath, head, workdir, stage]) =>
          !internalPaths.some((prefix) => filepath.startsWith(prefix)) &&
          !(head === 1 && workdir === 1 && stage === 1),
      )
      .map(([filepath, head, workdir, stage]) => ({
        filepath,
        code:
          head === 0 ? "?" : workdir === 0 ? "D" : workdir !== head ? "M" : "A",
        staged: stage !== head,
        unstaged: workdir !== stage,
      }));
  }

  async stage(filepath: string): Promise<void> {
    const change = (await this.changes()).find(
      (candidate) => candidate.filepath === filepath,
    );
    if (change?.code === "D")
      await git.remove({ fs: this.#adapter.client, dir: this.#dir, filepath });
    else await git.add({ fs: this.#adapter.client, dir: this.#dir, filepath });
  }

  async unstage(filepath: string): Promise<void> {
    await git.resetIndex({
      fs: this.#adapter.client,
      dir: this.#dir,
      filepath,
    });
  }

  async commit(message: string, author: GitIdentity): Promise<string> {
    if (!message.trim()) throw new Error("Enter a commit message.");
    if (!author.name.trim() || !author.email.trim())
      throw new Error("Enter a commit name and email address.");
    if (!(await this.changes()).some((change) => change.staged))
      throw new Error("Stage at least one change before committing.");
    return git.commit({
      fs: this.#adapter.client,
      dir: this.#dir,
      message: message.trim(),
      author: { name: author.name.trim(), email: author.email.trim() },
    });
  }

  async currentBranch(): Promise<string | undefined> {
    const branch = await git.currentBranch({
      fs: this.#adapter.client,
      dir: this.#dir,
      fullname: false,
    });
    return typeof branch === "string" ? branch : undefined;
  }

  async branches(): Promise<string[]> {
    return git.listBranches({ fs: this.#adapter.client, dir: this.#dir });
  }

  async createBranch(name: string): Promise<void> {
    const ref = name.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(ref))
      throw new Error("Enter a valid branch name.");
    await git.branch({ fs: this.#adapter.client, dir: this.#dir, ref });
    await this.checkout(ref);
  }

  async checkout(ref: string): Promise<void> {
    await git.checkout({ fs: this.#adapter.client, dir: this.#dir, ref });
  }

  async diff(filepath: string): Promise<string> {
    const after = await this.readWorktree(filepath);
    let before = "";
    try {
      const oid = await git.resolveRef({
        fs: this.#adapter.client,
        dir: this.#dir,
        ref: "HEAD",
      });
      const blob = await git.readBlob({
        fs: this.#adapter.client,
        dir: this.#dir,
        oid,
        filepath,
      });
      before = new TextDecoder().decode(blob.blob);
    } catch {
      // New and deleted files legitimately have only one side of the diff.
    }
    return unifiedDiff(filepath, before, after);
  }

  private async readWorktree(filepath: string): Promise<string> {
    try {
      return fileText(await this.workspace.read(normalizePath(`/${filepath}`)));
    } catch {
      return "";
    }
  }
}

export function unifiedDiff(
  filepath: string,
  before: string,
  after: string,
): string {
  if (before === after) return `No changes in ${filepath}`;
  const left = before.replace(/\n$/u, "").split("\n");
  const right = after.replace(/\n$/u, "").split("\n");
  if (left.length * right.length > 250_000)
    return `--- a/${filepath}\n+++ b/${filepath}\n@@ file changed (diff too large to render) @@`;
  const lengths = Array.from(
    { length: left.length + 1 },
    () => new Uint32Array(right.length + 1),
  );
  for (let i = left.length - 1; i >= 0; i--)
    for (let j = right.length - 1; j >= 0; j--)
      lengths[i]![j] =
        left[i] === right[j]
          ? lengths[i + 1]![j + 1]! + 1
          : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
  const body: string[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      body.push(` ${left[i]}`);
      i++;
      j++;
    } else if (
      j < right.length &&
      (i === left.length || lengths[i]![j + 1]! >= lengths[i + 1]![j]!)
    ) {
      body.push(`+${right[j++]}`);
    } else {
      body.push(`-${left[i++]}`);
    }
  }
  return `--- a/${filepath}\n+++ b/${filepath}\n@@ -1,${left.length} +1,${right.length} @@\n${body.join("\n")}`;
}
