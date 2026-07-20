import { expect, test } from "./fixtures.js";

test("runs shared language tooling and live exports", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("./");

  const diagram = page.getByRole("region", {
    name: "Live INTERLIS diagram",
  });
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

  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByText(/Compile succeeded:/u)).toBeVisible();

  const svgDownload = page.waitForEvent("download");
  await diagram.getByRole("button", { name: "SVG", exact: true }).click();
  expect((await svgDownload).suggestedFilename()).toMatch(/\.svg$/u);

  const docxDownload = page.waitForEvent("download");
  await diagram.getByRole("button", { name: "DOCX", exact: true }).click();
  expect((await docxDownload).suggestedFilename()).toMatch(/\.docx$/u);
});
