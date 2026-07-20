import { expect, test } from "./fixtures.js";

test("stages, commits and restores a local repository", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("./");
  await expect(page.getByText("No Git", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "⑂", exact: true }).click();
  await page
    .getByRole("button", { name: "Initialize Repository", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Stage", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stage", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Unstage", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Commit message" })
    .fill("Initial browser model");
  await page.getByRole("textbox", { name: "Commit name" }).fill("INTERLIS E2E");
  await page
    .getByRole("textbox", { name: "Commit email" })
    .fill("e2e@example.invalid");
  await page
    .getByRole("button", { name: "Commit Staged Changes", exact: true })
    .click();
  await expect(
    page.getByText("No local changes.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "⑂", exact: true }).click();
  await expect(
    page.getByText("No local changes.", { exact: true }),
  ).toBeVisible();
});
