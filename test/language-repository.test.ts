import { describe, expect, it } from "vitest";
import {
  browserRepositoryUrls,
  defaultRepositorySetting,
  geoadminMirrorRepository,
  interlisMirrorRepository,
  masterRepository,
  repositorySettingEntries,
  serializeRepositorySetting,
} from "../src/language-repository.js";

describe("browser repository configuration", () => {
  it("uses explicit mirrors followed by the master repository by default", () => {
    expect(defaultRepositorySetting).toBe(
      `%ILI_DIR;${interlisMirrorRepository};${geoadminMirrorRepository};${masterRepository}`,
    );
    expect(repositorySettingEntries(defaultRepositorySetting)).toEqual([
      "%ILI_DIR",
      interlisMirrorRepository,
      geoadminMirrorRepository,
      masterRepository,
    ]);
  });

  it("serializes structured repository entries without trailing slashes", () => {
    expect(
      serializeRepositorySetting([
        "%ILI_DIR",
        "https://custom.example/models/",
        "https://custom.example/models",
      ]),
    ).toBe("%ILI_DIR;https://custom.example/models");
  });

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
