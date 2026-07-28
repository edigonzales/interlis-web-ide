import { expect, test } from "./fixtures.js";

const performanceModel = `INTERLIS 2.4;
MODEL PerformanceModel AT "https://example.invalid" VERSION "1" =
  TOPIC Data =
${Array.from(
  { length: 55 },
  (_, index) => `    CLASS Item${index} =
      Label: TEXT*120;
      Description: MTEXT;
    END Item${index};`,
).join("\n")}
  END Data;
END PerformanceModel.
`;

test("keeps explorer and outline responsive during a 5 KB edit burst", async ({
  page,
  browserName,
}) => {
  test.setTimeout(60_000);
  test.skip(browserName !== "chromium", "Performance regression runs once");
  expect(performanceModel.length).toBeGreaterThan(4_500);
  expect(performanceModel.length).toBeLessThan(6_500);

  const workspaceId = `performance-e2e-${Date.now()}`;
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
              name: "Performance E2E",
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
      const model = await workspace.getFileHandle("Performance.ili", {
        create: true,
      });
      const writer = await model.createWritable();
      await writer.write(source);
      await writer.close();
    },
    { id: workspaceId, source: performanceModel },
  );

  await page.goto("./");
  await expect(page.locator("#compile-status")).toContainText("compiled");
  await expect(page.locator(".file-tree")).toContainText("Performance.ili");
  const editor = page.getByRole("textbox", { name: "Editor content" }).first();
  await editor.focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("!! ");

  const explorerStarted = performance.now();
  await page.keyboard.type("x".repeat(100));
  const explorerElapsed = performance.now() - explorerStarted;
  expect(explorerElapsed).toBeLessThan(2_000);
  await expect(page.locator(".file-tree")).toContainText("Performance.ili");

  await page.getByRole("button", { name: "Outline", exact: true }).click();
  const tree = page.getByRole("tree", { name: "Document symbols" });
  await expect(tree).toBeVisible();
  await editor.focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("!! ");

  const outlineStarted = performance.now();
  await page.keyboard.type("y".repeat(100));
  const outlineElapsed = performance.now() - outlineStarted;
  expect(outlineElapsed).toBeLessThan(2_000);
  await expect(tree).toBeVisible();
  await expect(tree).toContainText("Item54");
  await page.getByRole("button", { name: "Explorer", exact: true }).click();
  await expect(page.locator(".file-tree")).toContainText("Performance.ili");
});
