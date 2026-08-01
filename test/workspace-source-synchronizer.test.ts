import { describe, expect, it } from "vitest";
import { WorkspaceSourceSynchronizer } from "../src/workspace/source-synchronizer.js";

describe("WorkspaceSourceSynchronizer", () => {
  it("updates only changed files and removes files absent from the workspace", () => {
    const calls: string[] = [];
    const synchronizer = new WorkspaceSourceSynchronizer({
      putWorkspaceSource: (uri, text, version) =>
        calls.push(`put:${uri}:${text}:${version}`),
      removeWorkspaceSource: (uri) => calls.push(`remove:${uri}`),
    });

    synchronizer.sync([
      { uri: "memory:///A.ili", text: "A" },
      { uri: "memory:///B.ili", text: "B" },
    ]);
    synchronizer.sync([
      { uri: "memory:///A.ili", text: "A" },
      { uri: "memory:///B.ili", text: "B2" },
    ]);
    synchronizer.sync([{ uri: "memory:///B.ili", text: "B2" }]);

    expect(calls).toEqual([
      "put:memory:///A.ili:A:1",
      "put:memory:///B.ili:B:2",
      "put:memory:///B.ili:B2:3",
      "remove:memory:///A.ili",
    ]);
  });

  it("forwards an explicit version-only update without resending unchanged bytes", () => {
    const calls: Array<[string, string, number | undefined]> = [];
    const synchronizer = new WorkspaceSourceSynchronizer({
      putWorkspaceSource: (uri, text, version) =>
        calls.push([uri, text, version]),
      removeWorkspaceSource: () => {},
    });

    synchronizer.sync([{ uri: "memory:///A.ili", text: "A", version: 7 }]);
    synchronizer.sync([{ uri: "memory:///A.ili", text: "A", version: 8 }]);

    expect(calls).toEqual([
      ["memory:///A.ili", "A", 7],
      ["memory:///A.ili", "A", 8],
    ]);
  });
});
