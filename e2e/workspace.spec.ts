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
