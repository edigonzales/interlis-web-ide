import { FileSystemAccessWorkspace } from "./file-system-access.js";

type PermissionStateLike = "granted" | "denied" | "prompt";
interface PermissionHandle extends FileSystemDirectoryHandle {
  queryPermission?(descriptor?: {
    mode?: "read" | "readwrite";
  }): Promise<PermissionStateLike>;
  requestPermission?(descriptor?: {
    mode?: "read" | "readwrite";
  }): Promise<PermissionStateLike>;
}

declare global {
  interface Window {
    showDirectoryPicker?(options?: {
      id?: string;
      mode?: "read" | "readwrite";
    }): Promise<FileSystemDirectoryHandle>;
  }
}

export type LocalFolderState =
  "unsupported" | "connected" | "reconnect-required";

export class LocalFolderWorkspace extends FileSystemAccessWorkspace {
  #state: LocalFolderState = "reconnect-required";

  get state(): LocalFolderState {
    return this.#state;
  }

  async checkPermission(): Promise<LocalFolderState> {
    const handle = this.root as PermissionHandle;
    this.#state =
      (await handle.queryPermission?.({ mode: "readwrite" })) === "granted"
        ? "connected"
        : "reconnect-required";
    return this.#state;
  }

  async reconnect(): Promise<boolean> {
    const handle = this.root as PermissionHandle;
    this.#state =
      (await handle.requestPermission?.({ mode: "readwrite" })) === "granted"
        ? "connected"
        : "reconnect-required";
    return this.#state === "connected";
  }

  static async pick(): Promise<LocalFolderWorkspace> {
    if (!window.showDirectoryPicker)
      throw new Error("Local folders require the File System Access API.");
    const workspace = new LocalFolderWorkspace(
      await window.showDirectoryPicker({
        id: "interlis-workspace",
        mode: "readwrite",
      }),
    );
    await workspace.checkPermission();
    return workspace;
  }
}

export class DirectoryHandleStore {
  constructor(private readonly databaseName = "interlis-web-ide") {}

  async save(key: string, handle: FileSystemDirectoryHandle): Promise<void> {
    const database = await this.#open();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("handles", "readwrite");
      transaction.objectStore("handles").put(handle, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(
          transaction.error ?? new Error("Failed to save directory handle"),
        );
    });
    database.close();
  }

  async load(key: string): Promise<FileSystemDirectoryHandle | null> {
    const database = await this.#open();
    const handle = await new Promise<FileSystemDirectoryHandle | null>(
      (resolve, reject) => {
        const request = database
          .transaction("handles")
          .objectStore("handles")
          .get(key);
        request.onsuccess = () =>
          resolve(
            (request.result as FileSystemDirectoryHandle | undefined) ?? null,
          );
        request.onerror = () =>
          reject(request.error ?? new Error("Failed to load directory handle"));
      },
    );
    database.close();
    return handle;
  }

  #open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("handles");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Failed to open handle database"));
    });
  }
}
