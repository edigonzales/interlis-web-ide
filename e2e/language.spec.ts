import { readFile } from "node:fs/promises";
import { expect, test } from "./fixtures.js";

test("runs shared language tooling and live exports", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("./");

  const diagram = page.getByRole("region", {
    name: "Live INTERLIS diagram",
  });
  await expect(diagram).toContainText("Save or compile");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator("#output")).toContainText(
    "ilic completed with no errors, no warnings.",
  );
  await expect(diagram.locator("svg")).toBeVisible();
  await expect(diagram.locator(".ili-node").first()).toBeVisible();

  await page.locator('[data-view="settings"]').click();
  await page
    .getByRole("combobox", { name: "Diagram edge routing" })
    .selectOption("ORTHOGONAL");
  await expect(diagram.locator("svg")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem("interlis-web-ide.diagram-settings"),
      ),
    )
    .toContain("ORTHOGONAL");

  await page.getByRole("button", { name: /PROBLEMS/u }).click();
  await expect(page.locator("#problems")).toContainText("0 errors, 0 warnings");
  await page.getByRole("button", { name: "OUTPUT", exact: true }).click();
  await expect(page.locator("#output")).toBeVisible();

  const svgDownload = page.waitForEvent("download");
  await diagram.getByRole("button", { name: "SVG", exact: true }).click();
  expect((await svgDownload).suggestedFilename()).toMatch(/\.svg$/u);

  const docxDownload = page.waitForEvent("download");
  await diagram.getByRole("button", { name: "DOCX", exact: true }).click();
  expect((await docxDownload).suggestedFilename()).toMatch(/\.docx$/u);
});

test("save replaces structured Problems and compiler Output together", async ({
  page,
  browserName,
}) => {
  test.setTimeout(60_000);
  test.skip(
    browserName !== "chromium",
    "Structured Problems smoke is run once",
  );
  const workspaceId = `compilation-e2e-${browserName}-${Date.now()}`;
  await page.goto("./icon.svg");
  await page.evaluate(
    async ({ id, source }) => {
      sessionStorage.setItem("interlis-web-ide.active-workspace", id);
      const root = await navigator.storage.getDirectory();
      const metadata = await root.getDirectoryHandle(".interlis", {
        create: true,
      });
      const metadataFile = await metadata.getFileHandle("workspaces.json", {
        create: true,
      });
      const metadataWriter = await metadataFile.createWritable();
      await metadataWriter.write(
        JSON.stringify({
          schemaVersion: 1,
          workspaces: [
            {
              id,
              name: "Compilation E2E",
              kind: "opfs",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        }),
      );
      await metadataWriter.close();
      const workspaces = await root.getDirectoryHandle("workspaces", {
        create: true,
      });
      const workspace = await workspaces.getDirectoryHandle(id, {
        create: true,
      });
      const model = await workspace.getFileHandle("Model.ili", {
        create: true,
      });
      const writer = await model.createWritable();
      await writer.write(source);
      await writer.close();
    },
    {
      id: workspaceId,
      source: `INTERLIS 2.4;
MODEL Valid (en) AT "https://example.invalid" VERSION "1" =
END Valid.
`,
    },
  );
  await page.goto("./");
  const editorInput = page
    .getByRole("textbox", { name: "Editor content" })
    .first();
  await editorInput.focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("BROKEN");
  await page.keyboard.press("Control+S");

  const problem = page.locator("#problems .problem-row").first();
  await expect(problem).toBeVisible();
  await expect(page.locator("#problem-count")).not.toHaveText("0");
  await problem.click();
  await expect(page.locator("#cursor-status")).not.toHaveText("Ln 1, Col 1");
  await page.getByRole("button", { name: "OUTPUT", exact: true }).click();
  await expect(page.locator("#output")).toContainText("err:");
  await expect(page.locator("#output")).toContainText("ilic completed with");
  await expect(page.locator("#output")).not.toContainText("Saved /Model.ili");

  await editorInput.focus();
  await page.keyboard.press("Control+End");
  for (let index = 0; index < "BROKEN".length; index++)
    await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await expect(page.locator(".view-lines")).toContainText("INTERLIS 2.4;");
  await page.keyboard.press("Control+S");
  await expect(page.locator("#compile-status")).toContainText("compiled");
  await page.getByRole("button", { name: /PROBLEMS/u }).click();
  await expect(page.locator("#problems .problem-row")).toHaveCount(0);
  await expect(page.locator("#problems")).toContainText("0 errors, 0 warnings");
  await page.getByRole("button", { name: "OUTPUT", exact: true }).click();
  await expect(page.locator("#output")).toContainText(
    "ilic completed with no errors, no warnings.",
  );
});

test("opens an imported repository model as a read-only tab", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Repository Ctrl-click smoke is run once",
  );
  const definitionModifier: "Meta" | "Control" = await page.evaluate(() =>
    navigator.userAgent.includes("Macintosh") ? "Meta" : "Control",
  );
  const catalog = `<?xml version="1.0"?>
<TRANSFER><DATASECTION><IliRepository20.RepositoryIndex.ModelMetadata>
  <Name>Units</Name><File>Units.ili</File>
  <SchemaLanguage>ili2_4</SchemaLanguage><Version>1</Version>
</IliRepository20.RepositoryIndex.ModelMetadata></DATASECTION></TRANSFER>`;
  const units = await readFile(
    new URL("./models/Units.ili", import.meta.url),
    "utf8",
  );
  await page.route("https://models.example/**", async (route) => {
    const body = route.request().url().endsWith("ilimodels.xml")
      ? catalog
      : units;
    await route.fulfill({
      body,
      contentType: "text/plain; charset=utf-8",
      headers: { "access-control-allow-origin": "*" },
    });
  });
  await page.goto("./icon.svg");
  await page.evaluate(
    (source) => {
      localStorage.setItem(
        "interlis-web-ide.model-repositories",
        "%ILI_DIR;https://models.example",
      );
      sessionStorage.setItem(
        "interlis-web-ide.active-workspace",
        "repository-e2e",
      );
      return navigator.storage.getDirectory().then(async (root) => {
        const metadata = await root.getDirectoryHandle(".interlis", {
          create: true,
        });
        const metadataFile = await metadata.getFileHandle("workspaces.json", {
          create: true,
        });
        const metadataWriter = await metadataFile.createWritable();
        await metadataWriter.write(
          JSON.stringify({
            schemaVersion: 1,
            workspaces: [
              {
                id: "repository-e2e",
                name: "Repository E2E",
                kind: "opfs",
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          }),
        );
        await metadataWriter.close();
        const workspaces = await root.getDirectoryHandle("workspaces", {
          create: true,
        });
        const workspace = await workspaces.getDirectoryHandle(
          "repository-e2e",
          {
            create: true,
          },
        );
        const model = await workspace.getFileHandle("Model.ili", {
          create: true,
        });
        const writer = await model.createWritable();
        await writer.write(source);
        await writer.close();
      });
    },
    `INTERLIS 2.4;
MODEL Root (en) AT "https://example.invalid" VERSION "1" =
END Root.
`,
  );
  await page.goto("./");
  await page.locator(".view-lines").click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText(`INTERLIS 2.4;
MODEL Root (en) AT "https://example.invalid" VERSION "1" =
  IMPORTS Units;
END Root.
`);
  await page.keyboard.press(`${definitionModifier}+S`);
  await expect(page.locator("#compile-status")).toContainText("compiled");

  const ctrlClickUnits = async (): Promise<void> => {
    const importLine = page.locator(".view-line", {
      hasText: "IMPORTS Units;",
    });
    await expect(importLine).toBeVisible();
    await importLine.click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Home");
    await page.keyboard.press("Home");
    for (let column = 0; column < 10; column++)
      await page.keyboard.press("ArrowRight");
    await page.keyboard.press("F12");
    await expect(page.locator("#breadcrumbs")).toContainText("Repository");
  };

  await ctrlClickUnits();

  await expect(page.getByRole("button", { name: /Units\.ili/u })).toContainText(
    "🔒",
  );
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText("CHANGED");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Cannot edit in read-only editor" }),
  ).toBeVisible();

  await page
    .locator("#tabs")
    .getByRole("button", { name: /Model\.ili/u })
    .click();
  await page.keyboard.press(`${definitionModifier}+S`);
  await expect(
    page
      .locator("#tabs")
      .getByRole("button", { name: "Model.ili", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.unroute("https://models.example/**");
  await page.context().setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator("#output")).toContainText(
    "ilic completed with no errors, no warnings.",
  );
  await expect(page.locator("#diagram-host svg")).toBeVisible();
  await ctrlClickUnits();
});
