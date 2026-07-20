import { describe, expect, it } from "vitest";
import { browserRepositoryUrls } from "../src/language-repository.js";

describe("browser repository configuration", () => {
  it("maps the central repository to both temporary CORS mirrors", () => {
    expect(
      browserRepositoryUrls(
        "%ILI_DIR;https://models.interlis.ch;https://custom.example/models",
      ),
    ).toEqual([
      "https://geo.so.ch/models/mirror/interlis.ch",
      "https://geo.so.ch/models/mirror/geoadmin",
      "https://custom.example/models",
    ]);
  });

  it("deduplicates the federal mirror alias", () => {
    expect(
      browserRepositoryUrls(
        "https://models.interlis.ch;http://models.geo.admin.ch/",
      ),
    ).toEqual([
      "https://geo.so.ch/models/mirror/interlis.ch",
      "https://geo.so.ch/models/mirror/geoadmin",
    ]);
  });
});
