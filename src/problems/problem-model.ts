import type { Diagnostic } from "@ilic/language-service";

export interface ProblemRelatedInformation {
  readonly uri: string;
  readonly message: string;
  readonly range: Diagnostic["range"];
}

export interface ProblemItem {
  readonly id: string;
  readonly uri: string;
  readonly severity: Diagnostic["severity"];
  readonly code: string;
  readonly source?: Diagnostic["source"];
  readonly message: string;
  readonly range: Diagnostic["range"];
  readonly relatedInformation: readonly ProblemRelatedInformation[];
  readonly notes: readonly string[];
}

export function problemId(diagnostic: Diagnostic, rootUri: string): string {
  const range = diagnostic.range;
  return [
    range?.uri ?? rootUri,
    diagnostic.code,
    range?.start.byteOffset ?? -1,
    range?.end.byteOffset ?? -1,
    diagnostic.fingerprint ?? diagnostic.message,
  ].join("\u001f");
}
