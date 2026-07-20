import { describe, expect, it, vi } from "vitest";
import {
  BufferRecoveryStore,
  MemoryWorkspaceFileSystem,
  RepositoryModelCache,
  WorkspaceManager,
  exportWorkspaceZip,
  fileText,
  importWorkspaceZip,
  normalizePath,
  repositoryDirectories,
  textFile,
} from "../src/workspace/index.js";

describe("workspace filesystem", () => {
  it("supports binary CRUD, recursive directories, rename and watches", async () => {
    const workspace = new MemoryWorkspaceFileSystem();
    const changes: string[] = [];
    workspace.watch("/models", (events) =>
      changes.push(...events.map((event) => event.type)),
    );
    await workspace.write("/models/A.ili", textFile("A"));
    expect(fileText(await workspace.read("/models/A.ili"))).toBe("A");
    expect(await workspace.stat("/models/A.ili")).toMatchObject({
      type: "file",
      size: 1,
    });
    await workspace.rename("/models/A.ili", "/models/B.ili");
    expect(await workspace.readDirectory("/models")).toEqual([
      ["B.ili", "file"],
    ]);
    await expect(workspace.delete("/models")).rejects.toThrow("not empty");
    await workspace.delete("/models", { recursive: true });
    expect(changes).toEqual(expect.arrayContaining(["created", "deleted"]));
  });

  it("normalizes paths without allowing workspace escapes", () => {
    expect(normalizePath("models\\A.ili")).toBe("/models/A.ili");
    expect(() => normalizePath("../secret")).toThrow("escapes workspace");
  });
});

describe("named workspaces and recovery", () => {
  it("persists named OPFS workspace metadata and one active workspace", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValueOnce(
      "00000000-0000-4000-8000-000000000001",
    );
    const root = new MemoryWorkspaceFileSystem();
    const values = new Map<string, string>();
    const session = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    };
    const manager = new WorkspaceManager(root, session);
    expect((await manager.initialize()).name).toBe("INTERLIS Workspace");
    await manager.activeFileSystem.write("/Model.ili", textFile("MODEL"));
    await manager.rename(manager.activeDescriptor!.id, "Cadastre");
    expect(manager.activeDescriptor?.name).toBe("Cadastre");

    const restored = new WorkspaceManager(root, session);
    await restored.initialize();
    expect(fileText(await restored.activeFileSystem.read("/Model.ili"))).toBe(
      "MODEL",
    );
    vi.restoreAllMocks();
  });

  it("recovers and clears unsaved buffers from the active filesystem", async () => {
    const workspace = new MemoryWorkspaceFileSystem();
    const recovery = new BufferRecoveryStore(workspace);
    await recovery.save("opfs://workspace/Model.ili", 4, "unsaved");
    expect(await recovery.restore("opfs://workspace/Model.ili")).toMatchObject({
      version: 4,
      text: "unsaved",
    });
    expect(await recovery.list()).toHaveLength(1);
    await recovery.clear("opfs://workspace/Model.ili");
    expect(await recovery.list()).toEqual([]);
  });
});

describe("portable ZIP and repository cache", () => {
  it("round-trips a workspace ZIP", async () => {
    const source = new MemoryWorkspaceFileSystem();
    await source.write("/models/A.ili", textFile("INTERLIS 2.4;"));
    const target = new MemoryWorkspaceFileSystem();
    expect(
      await importWorkspaceZip(target, await exportWorkspaceZip(source)),
    ).toEqual(["/models/A.ili"]);
    expect(fileText(await target.read("/models/A.ili"))).toBe("INTERLIS 2.4;");
  });

  it("supports repository aliases, both separators and offline model caching", async () => {
    expect(
      repositoryDirectories(
        "%ILI_DIR, https://models.interlis.ch;%JAR_DIR",
        "/project",
        "/bundled",
      ),
    ).toEqual(["/project", "https://models.interlis.ch", "/bundled"]);
    const workspace = new MemoryWorkspaceFileSystem();
    const cache = new RepositoryModelCache(workspace);
    await cache.put("https://models.interlis.ch", "Units", "MODEL Units");
    expect(await cache.get("https://models.interlis.ch", "Units")).toBe(
      "MODEL Units",
    );
    expect(await cache.get("https://models.interlis.ch", "Missing")).toBeNull();
  });
});
