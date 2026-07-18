import { describe, expect, it } from "vitest";
import { GitService, unifiedDiff } from "../src/git/index.js";
import { MemoryWorkspaceFileSystem, textFile } from "../src/workspace/index.js";

describe("GitService", () => {
  it("initializes, stages, commits, diffs and branches in the workspace fs", async () => {
    const workspace = new MemoryWorkspaceFileSystem();
    await workspace.write(
      "/Model.ili",
      textFile("MODEL First =\nEND First.\n"),
    );
    const service = new GitService(workspace);

    expect(await service.isRepository()).toBe(false);
    await service.initialize();
    expect(await service.isRepository()).toBe(true);
    expect(await service.changes()).toEqual([
      {
        filepath: "Model.ili",
        code: "?",
        staged: false,
        unstaged: true,
      },
    ]);

    await service.stage("Model.ili");
    expect((await service.changes())[0]?.staged).toBe(true);
    const oid = await service.commit("Initial model", {
      name: "INTERLIS User",
      email: "user@example.invalid",
    });
    expect(oid).toMatch(/^[0-9a-f]{40}$/u);
    expect(await service.currentBranch()).toBe("main");
    expect(await service.changes()).toEqual([]);

    await workspace.write(
      "/Model.ili",
      textFile("MODEL Second =\nEND Second.\n"),
    );
    expect((await service.changes())[0]).toMatchObject({
      code: "M",
      staged: false,
      unstaged: true,
    });
    expect(await service.diff("Model.ili")).toContain("-MODEL First =");
    expect(await service.diff("Model.ili")).toContain("+MODEL Second =");

    await service.stage("Model.ili");
    expect((await service.changes())[0]?.staged).toBe(true);
    await service.unstage("Model.ili");
    expect((await service.changes())[0]?.staged).toBe(false);

    await service.createBranch("feature/model");
    expect(await service.currentBranch()).toBe("feature/model");
    expect(await service.branches()).toContain("feature/model");
  });

  it("rejects unsupported clone transports before changing the workspace", async () => {
    const service = new GitService(new MemoryWorkspaceFileSystem());
    await expect(
      service.clone("git@github.com:example/repo.git"),
    ).rejects.toThrow("public HTTPS");
  });
});

describe("unifiedDiff", () => {
  it("renders additions, removals and context", () => {
    const diff = unifiedDiff("model.ili", "one\ntwo\n", "one\nthree\n");
    expect(diff).toContain(" one");
    expect(diff).toContain("-two");
    expect(diff).toContain("+three");
  });
});
