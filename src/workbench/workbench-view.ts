import type { ProblemItem } from "../problems/problem-model.js";

export interface WorkbenchElements {
  readonly output: HTMLElement;
  readonly problems: HTMLElement;
  readonly outline: HTMLElement;
  readonly resultStatus: HTMLElement;
}

export class WorkbenchView {
  readonly #elements: WorkbenchElements;

  constructor(readonly host: HTMLElement) {
    const required = (selector: string): HTMLElement => {
      const element = host.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`WorkbenchView missing required element: ${selector}`);
      return element;
    };
    this.#elements = {
      output: required("#output"),
      problems: required("#problems"),
      outline:
        host.querySelector<HTMLElement>("#outline") ?? required("#sidebar-content"),
      resultStatus: required("#result-status"),
    };
  }

  elements(): WorkbenchElements { return this.#elements; }
  renderOutput(text: string): void { this.#elements.output.textContent = text; }
  renderStatus(text: string): void { this.#elements.resultStatus.textContent = text; }
  renderProblems(items: readonly ProblemItem[]): void {
    this.#elements.problems.replaceChildren(...items.map((item) => {
      const row = document.createElement("div");
      row.className = `problem-row ${item.severity}`;
      row.textContent = item.message;
      return row;
    }));
  }
  renderOutline(items: readonly { readonly label: string }[]): void {
    this.#elements.outline.replaceChildren(...items.map((item) => {
      const row = document.createElement("div");
      row.textContent = item.label;
      return row;
    }));
  }
  dispose(): void { this.#elements.output.replaceChildren(); this.#elements.problems.replaceChildren(); this.#elements.outline.replaceChildren(); }
}
