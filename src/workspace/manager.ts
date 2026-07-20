import { PrefixWorkspaceFileSystem } from "./file-system-access.js";
import type { WorkspaceFileSystem } from "./types.js";

export interface WorkspaceDescriptor {
  readonly id: string;
  readonly name: string;
  readonly kind: "opfs" | "local-folder";
  readonly createdAt: string;
}

interface WorkspaceMetadata {
  readonly schemaVersion: 1;
  readonly workspaces: readonly WorkspaceDescriptor[];
}

const metadataPath = "/.interlis/workspaces.json";
const activeKey = "interlis-web-ide.active-workspace";

export class WorkspaceManager {
  readonly #encoder = new TextEncoder();
  readonly #decoder = new TextDecoder();
  #descriptors: WorkspaceDescriptor[] = [];
  #active: WorkspaceDescriptor | null = null;
  #mounted: WorkspaceFileSystem | null = null;

  constructor(
    private readonly opfsRoot: WorkspaceFileSystem,
    private readonly session: Pick<
      Storage,
      "getItem" | "setItem" | "removeItem"
    >,
  ) {}

  get workspaces(): readonly WorkspaceDescriptor[] {
    return this.#descriptors;
  }
  get activeDescriptor(): WorkspaceDescriptor | null {
    return this.#active;
  }
  get activeFileSystem(): WorkspaceFileSystem {
    if (!this.#mounted)
      throw new Error("WorkspaceManager has not been initialized");
    return this.#mounted;
  }

  async initialize(): Promise<WorkspaceDescriptor> {
    await this.#load();
    if (this.#descriptors.length === 0) await this.create("INTERLIS Workspace");
    const requested = this.session.getItem(activeKey);
    const descriptor =
      this.#descriptors.find((candidate) => candidate.id === requested) ??
      this.#descriptors[0]!;
    await this.activate(descriptor.id);
    return descriptor;
  }

  async create(name: string): Promise<WorkspaceDescriptor> {
    const descriptor: WorkspaceDescriptor = {
      id: crypto.randomUUID(),
      name: name.trim() || "Untitled Workspace",
      kind: "opfs",
      createdAt: new Date().toISOString(),
    };
    this.#descriptors.push(descriptor);
    await this.opfsRoot.createDirectory(`/workspaces/${descriptor.id}`);
    await this.#save();
    await this.activate(descriptor.id);
    return descriptor;
  }

  activate(id: string): Promise<void> {
    const descriptor = this.#descriptors.find(
      (candidate) => candidate.id === id,
    );
    if (!descriptor) throw new Error(`Unknown workspace: ${id}`);
    this.#active = descriptor;
    this.#mounted = new PrefixWorkspaceFileSystem(
      this.opfsRoot,
      `/workspaces/${id}`,
    );
    this.session.setItem(activeKey, id);
    return Promise.resolve();
  }

  mountLocal(
    descriptor: WorkspaceDescriptor,
    workspace: WorkspaceFileSystem,
  ): void {
    this.#active = descriptor;
    this.#mounted = workspace;
    this.session.setItem(activeKey, descriptor.id);
  }

  async rename(id: string, name: string): Promise<void> {
    const index = this.#descriptors.findIndex(
      (candidate) => candidate.id === id,
    );
    if (index < 0) throw new Error(`Unknown workspace: ${id}`);
    this.#descriptors[index] = {
      ...this.#descriptors[index]!,
      name: name.trim() || "Untitled Workspace",
    };
    if (this.#active?.id === id) this.#active = this.#descriptors[index]!;
    await this.#save();
  }

  async remove(id: string): Promise<void> {
    const descriptor = this.#descriptors.find(
      (candidate) => candidate.id === id,
    );
    if (!descriptor) return;
    this.#descriptors = this.#descriptors.filter(
      (candidate) => candidate.id !== id,
    );
    await this.opfsRoot.delete(`/workspaces/${id}`, { recursive: true });
    if (this.#active?.id === id) {
      this.#active = null;
      this.#mounted = null;
      this.session.removeItem(activeKey);
    }
    await this.#save();
  }

  async #load(): Promise<void> {
    try {
      const value = JSON.parse(
        this.#decoder.decode(await this.opfsRoot.read(metadataPath)),
      ) as WorkspaceMetadata;
      this.#descriptors =
        value.schemaVersion === 1 ? [...value.workspaces] : [];
    } catch {
      this.#descriptors = [];
    }
  }

  async #save(): Promise<void> {
    const value: WorkspaceMetadata = {
      schemaVersion: 1,
      workspaces: this.#descriptors,
    };
    await this.opfsRoot.write(
      metadataPath,
      this.#encoder.encode(JSON.stringify(value, null, 2)),
      { create: true, overwrite: true },
    );
  }
}
