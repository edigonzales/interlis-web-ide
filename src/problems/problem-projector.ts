import type { Diagnostic } from "@ilic/language-service";
import type { ProblemItem } from "./problem-model.js";
import { problemId } from "./problem-model.js";

const severityRank: Record<Diagnostic["severity"], number> = {
  error: 0,
  warning: 1,
  information: 2,
  hint: 3,
};

export function projectProblems(
  diagnostics: readonly Diagnostic[],
  rootUri: string,
): ProblemItem[] {
  return diagnostics
    .map((diagnostic) => ({
      id: problemId(diagnostic, rootUri),
      uri: diagnostic.range?.uri ?? rootUri,
      severity: diagnostic.treatedAsError ? "error" : diagnostic.severity,
      code: diagnostic.code,
      source: diagnostic.source,
      message: diagnostic.message,
      range: diagnostic.range,
      relatedInformation: diagnostic.relatedInformation.flatMap((value) =>
        value.range
          ? [
              {
                uri: value.range.uri,
                range: value.range,
                message: value.message,
              },
            ]
          : [],
      ),
      notes: diagnostic.notes,
    }))
    .sort(
      (left, right) =>
        severityRank[left.severity] - severityRank[right.severity] ||
        left.uri.localeCompare(right.uri) ||
        (left.range?.start.byteOffset ?? Number.MAX_SAFE_INTEGER) -
          (right.range?.start.byteOffset ?? Number.MAX_SAFE_INTEGER) ||
        (left.range?.end.byteOffset ?? Number.MAX_SAFE_INTEGER) -
          (right.range?.end.byteOffset ?? Number.MAX_SAFE_INTEGER) ||
        left.code.localeCompare(right.code) ||
        left.message.localeCompare(right.message),
    );
}
