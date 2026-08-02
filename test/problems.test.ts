import { describe, expect, it } from "vitest";
import type { Diagnostic } from "@ilic/language-service";
import { projectProblems } from "../src/problems/problem-projector.js";
import { ProblemStore } from "../src/problems/problem-store.js";
import { problemSelection } from "../src/problems/problem-navigation.js";

const diagnostic = (
  code: string,
  severity: Diagnostic["severity"],
  offset: number,
): Diagnostic => ({
  severity,
  code,
  message: code,
  range: {
    uri: "memory:///Root.ili",
    start: { line: 0, character: offset, byteOffset: offset },
    end: { line: 0, character: offset + 1, byteOffset: offset + 1 },
  },
  relatedInformation: [],
  notes: [],
  treatedAsError: false,
  source: "compiler",
});

describe("structured Problems projection", () => {
  it("sorts, identifies and navigates diagnostics without rendered-text parsing", () => {
    const values = projectProblems(
      [diagnostic("W", "warning", 4), diagnostic("E", "error", 2)],
      "memory:///Root.ili",
    );
    expect(values.map((value) => value.code)).toEqual(["E", "W"]);
    expect(values[0]?.id).toContain("E");
    expect(problemSelection(values[0]!)).toEqual({
      startLineNumber: 1,
      startColumn: 3,
      endLineNumber: 1,
      endColumn: 4,
    });
  });

  it("clears all root problems on workspace replacement", () => {
    const store = new ProblemStore();
    const values = projectProblems(
      [diagnostic("E", "error", 0)],
      "memory:///Root.ili",
    );
    store.replace("memory:///Root.ili", values);
    expect(store.values()).toHaveLength(1);
    store.clear();
    expect(store.values()).toEqual([]);
  });
});
