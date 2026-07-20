import { expect, test } from "./fixtures.js";

test("shallow-clones the public SOGIS INTERLIS repository", async ({
  page,
}) => {
  test.skip(!process.env.RUN_PUBLIC_CLONE, "Public network smoke is opt-in");
  test.setTimeout(240_000);
  await page.goto("./");
  await page.getByRole("button", { name: "⑂", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Clone Repository", exact: true })
    .click();
  await expect(
    page.getByText("Repository cloned for offline work.", { exact: true }),
  ).toBeVisible({
    timeout: 210_000,
  });
  await expect(
    page.getByText("No local changes.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Current branch" }),
  ).toHaveValue("master");
});
