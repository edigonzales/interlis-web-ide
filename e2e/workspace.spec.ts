import { expect, test } from "./fixtures.js";

test("restores an unsaved Monaco buffer from OPFS", async ({
  page,
  browserName,
}) => {
  await page.goto("./");
  await expect(
    page.getByRole("main", { name: "INTERLIS Web IDE" }),
  ).toBeVisible();
  await page.getByText("INTERLIS 2.4;", { exact: true }).click();
  await page.keyboard.press("Control+Home");
  const marker = `!! recovered-${browserName}`;
  await page.keyboard.type(`${marker}\n`);
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByText(marker, { exact: true })).toBeVisible();
});

test("exports a workspace ZIP", async ({ page }) => {
  await page.goto("./");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export ZIP", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.zip$/u);
});

test("deletes a model from the Explorer after confirmation", async ({
  page,
}) => {
  await page.goto("./");
  const model = page
    .locator(".file-tree")
    .getByRole("button", { name: "Model.ili", exact: true });
  const remove = page.getByRole("button", {
    name: "Delete model Model.ili",
    exact: true,
  });

  await remove.click();
  const dialog = page.getByRole("dialog", { name: "Delete model?" });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(model).toBeVisible();

  await remove.click();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(model).toHaveCount(0);
  await expect(
    page
      .locator("#tabs")
      .getByRole("button", { name: "Model.ili", exact: true }),
  ).toHaveCount(0);
});

test("offers save or discard when deleting a dirty model", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "New file", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Editor content" }).first();
  await editor.focus();
  await page.keyboard.press("End");
  await page.keyboard.type("!! unsaved before delete");

  const remove = page.getByRole("button", {
    name: "Delete model Untitled-1.ili",
    exact: true,
  });
  await remove.click();
  const dialog = page.getByRole("dialog", { name: "Delete model?" });
  await expect(
    dialog.getByRole("button", { name: "Save & Delete", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", {
      name: "Delete without Saving",
      exact: true,
    }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Delete without Saving", exact: true })
    .click();
  await expect(remove).toHaveCount(0);
});

test("renames and deletes named workspaces", async ({ page }) => {
  await page.goto("./");
  await page
    .getByRole("button", { name: "Search / Command Palette", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Workspace: New Named Workspace",
      exact: true,
    })
    .click();

  const status = page.locator("#workspace-status");
  await expect(status).toHaveText("Workspace 2");
  await status.click();
  const picker = page.locator("#quick-pick");
  await picker
    .getByRole("button", { name: "Rename Workspace 2", exact: true })
    .click();
  const renameDialog = page.getByRole("dialog", { name: "Rename workspace" });
  await renameDialog.locator("#workspace-name-input").fill("Survey Models");
  await renameDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(status).toHaveText("Survey Models");

  await status.click();
  await picker
    .getByRole("button", { name: "Delete Survey Models", exact: true })
    .click();
  const deleteDialog = page.getByRole("dialog", {
    name: "Delete workspace?",
  });
  await deleteDialog
    .getByRole("button", { name: "Delete Workspace", exact: true })
    .click();
  await expect(status).toHaveText("INTERLIS Workspace");

  await status.click();
  await expect(
    picker
      .getByRole("button", { name: "Delete INTERLIS Workspace", exact: true })
      .first(),
  ).toBeDisabled();
});

test("reloads from the service worker while offline", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName === "webkit",
    "Playwright WebKit cannot exercise CacheStorage from its persistent OPFS context",
  );
  await page.goto("./");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  try {
    await page.goto("./");
    await expect(
      page.getByText("INTERLIS 2.4;", { exact: true }),
    ).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

test("opens a local folder handle in Chromium", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "File System Access is Chromium-only");
  await page.addInitScript(() => {
    window.showDirectoryPicker = () => navigator.storage.getDirectory();
  });
  await page.goto("./");
  await page.getByRole("button", { name: "Open folder", exact: true }).click();
  await expect(page.getByText(/Opened local folder/u)).toBeVisible();
});
