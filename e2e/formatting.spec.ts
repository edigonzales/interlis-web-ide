import { expect, test } from "./fixtures.js";

test("formats INTERLIS with two spaces per indentation level", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Formatting interaction is verified in Chromium",
  );
  await page.goto("./");
  await expect(page.locator("#compile-status")).toContainText("compiled");

  const editor = page.getByRole("textbox", { name: "Editor content" }).first();
  await editor.focus();
  const modifier = await page.evaluate(() =>
    navigator.userAgent.includes("Macintosh") ? "Meta" : "Control",
  );
  await page.keyboard.press(modifier + "+A");
  await page.keyboard.insertText(`INTERLIS 2.4;
MODEL M AT "https://example.invalid/models" VERSION "1" =
TOPIC T =
CLASS C =
Name : TEXT*20;
END C;
END T;
END M.`);

  await page.getByRole("button", { name: "Compile", exact: true }).click();
  await expect(page.locator("#compile-status")).toContainText("compiled");
  await page.locator(".view-lines").first().click({ button: "right" });
  await page.waitForTimeout(150);
  await page.getByRole("menuitem", { name: /Format Document/u }).click();
  await expect(page.locator('[role="menu"]')).toBeHidden();

  const source = page.locator(".view-lines");
  const formattedLines = await source
    .locator(".view-line")
    .evaluateAll((lines) =>
      lines.map((line) => (line.textContent ?? "").replaceAll("\u00a0", " ")),
    );
  expect(formattedLines).toEqual([
    "INTERLIS 2.4;",
    'MODEL M AT "https://example.invalid/models" VERSION "1" =',
    "  TOPIC T =",
    "    CLASS C =",
    "      Name : TEXT*20;",
    "    END C;",
    "  END T;",
    "END M.",
    "",
  ]);
});
