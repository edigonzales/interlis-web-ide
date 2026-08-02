import type { ProblemItem } from "./problem-model.js";

export function problemSelection(problem: ProblemItem) {
  const range = problem.range;
  return range
    ? {
        startLineNumber: range.start.line + 1,
        startColumn: range.start.character + 1,
        endLineNumber: range.end.line + 1,
        endColumn: range.end.character + 1,
      }
    : null;
}
