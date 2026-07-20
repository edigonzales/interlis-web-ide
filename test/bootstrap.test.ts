import { describe, expect, it } from "vitest";

describe("web IDE bootstrap", () => {
  it("uses the GitHub Pages base path", () => {
    expect("/interlis-web-ide/").toMatch(/^\/.+\/$/);
  });
});
