import { expect, test } from "./fixtures.js";

test("renders and persists structured settings", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Settings", exact: true }).click();

  await expect(page.locator("#sidebar-title")).toHaveText("SETTINGS");
  await expect(page.getByRole("heading", { name: "Settings" })).toHaveCount(0);
  await expect(page.getByLabel("INTERLIS mirror URL")).toHaveValue(
    "https://geo.so.ch/models/mirror/interlis.ch",
  );
  await expect(page.getByLabel("geo.admin.ch mirror URL")).toHaveValue(
    "https://geo.so.ch/models/mirror/geoadmin",
  );
  await expect(page.getByLabel("Master repository URL")).toHaveValue(
    "https://geo.so.ch/models",
  );
  await expect(page.locator(".repository-value-readonly")).toHaveText(
    "%ILI_DIR",
  );
  await expect(page.locator(".setting-help")).toContainText(
    "master repository follows as the last source",
  );

  await page.getByRole("button", { name: "Add repository" }).click();
  const additional = page.locator(".repository-url").last();
  await additional.fill("https://custom.example/models");
  await additional.blur();
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem("interlis-web-ide.model-repositories"),
      ),
    )
    .toContain("https://custom.example/models");
  await page
    .getByRole("button", { name: "Remove Additional repository" })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem("interlis-web-ide.model-repositories"),
      ),
    )
    .not.toContain("https://custom.example/models");

  await page.getByLabel("Editor font size").selectOption("16");
  await page.getByLabel("Editor format on type").uncheck();
  await page.getByLabel("Files auto save").selectOption("afterDelay");
  await page.getByLabel("Diagram visibility remembered").uncheck();
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem("interlis-web-ide.editor-settings"),
      ),
    )
    .toContain('"fontSize":16');

  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Editor font size")).toHaveValue("16");
  await expect(page.getByLabel("Editor format on type")).not.toBeChecked();
  await expect(page.getByLabel("Files auto save")).toHaveValue("afterDelay");
  await expect(
    page.getByLabel("Diagram visibility remembered"),
  ).not.toBeChecked();
});

test("auto-saves dirty editor content after the configured delay", async ({
  page,
}) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Files auto save").selectOption("afterDelay");
  await page.getByRole("button", { name: "Explorer", exact: true }).click();

  const editor = page.getByRole("textbox", { name: "Editor content" }).first();
  await editor.focus();
  await page.keyboard.press("End");
  await page.keyboard.type(" ");
  const activeTab = page.locator("#tabs .tab.active");
  await expect(activeTab).toHaveClass(/dirty/u);
  await expect(activeTab).not.toHaveClass(/dirty/u, { timeout: 4_000 });
});

test("remembers diagram visibility only when enabled", async ({ page }) => {
  await page.goto("./");
  const diagram = page.getByRole("region", {
    name: "Live INTERLIS diagram",
  });
  await expect(diagram).toBeVisible();

  const commandCenter = page.getByRole("button", {
    name: "Search / Command Palette",
    exact: true,
  });
  await commandCenter.click();
  await page
    .getByRole("button", { name: "View: Toggle Live Diagram", exact: true })
    .click();
  await expect(diagram).toBeHidden();
  await page.reload();
  await expect(diagram).toBeHidden();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Diagram visibility remembered").uncheck();
  await page.getByRole("button", { name: "Explorer", exact: true }).click();
  await commandCenter.click();
  await page
    .getByRole("button", { name: "View: Toggle Live Diagram", exact: true })
    .click();
  await expect(diagram).toBeVisible();
  await commandCenter.click();
  await page
    .getByRole("button", { name: "View: Toggle Live Diagram", exact: true })
    .click();
  await expect(diagram).toBeHidden();
  await page.reload();
  await expect(diagram).toBeVisible();
});

test("closes the diagram when closing the active model", async ({ page }) => {
  await page.goto("./");
  const diagram = page.getByRole("region", {
    name: "Live INTERLIS diagram",
  });
  await expect(diagram).toBeVisible();

  await page
    .locator("#tabs")
    .getByRole("button", { name: "Close Model.ili", exact: true })
    .click();
  await expect(diagram).toBeHidden();
});

test("light-dismisses the compact Codicon command palette", async ({
  page,
}) => {
  await page.goto("./");

  await expect(
    page.locator('[data-view="explorer"] .codicon-files'),
  ).toBeVisible();
  await expect(
    page.locator('[data-view="outline"] .codicon-list-tree'),
  ).toBeVisible();

  const commandCenter = page.getByRole("button", {
    name: "Search / Command Palette",
    exact: true,
  });
  const palette = page.locator("#quick-pick");
  await commandCenter.click();
  await expect(palette).toBeVisible();
  await expect(page.locator("#quick-input")).toHaveCSS("font-size", "12px");
  await expect(page.locator("#quick-items button").first()).toHaveCSS(
    "font-size",
    "12px",
  );
  expect(await page.locator("#quick-items button").allTextContents()).toEqual([
    "Explorer: Refresh",
    "File: Close Editor",
    "File: New INTERLIS Model",
    "File: Open Local Folder…",
    "File: Save",
    "INTERLIS: Compile Model",
    "INTERLIS: Export Diagram as SVG",
    "INTERLIS: Export Documentation as DOCX",
    "INTERLIS: New Model from Remote Template",
    "INTERLIS: Refresh Diagram / Auto-layout",
    "Outline: Collapse All",
    "Preferences: Toggle Color Theme",
    "View: Split Editor",
    "View: Toggle Live Diagram",
    "View: Toggle Panel",
    "Workspace: Delete Current Workspace…",
    "Workspace: Export ZIP",
    "Workspace: Import ZIP…",
    "Workspace: New Named Workspace",
    "Workspace: Rename Current Workspace…",
  ]);
  await page.locator("#quick-input").fill(">export");
  expect(await page.locator("#quick-items button").allTextContents()).toEqual([
    "INTERLIS: Export Diagram as SVG",
    "INTERLIS: Export Documentation as DOCX",
    "Workspace: Export ZIP",
  ]);

  await page.getByRole("button", { name: "Explorer", exact: true }).click();
  await expect(palette).toBeHidden();

  await commandCenter.click();
  await expect(palette).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();

  await expect(page.locator("#result-status")).toHaveCSS("font-size", "12px");
  await expect(page.locator("#result-status")).toHaveCSS(
    "color",
    "rgb(150, 150, 150)",
  );
});

test("matches the VS Code search field typography and searches files", async ({
  page,
}) => {
  await page.goto("./");
  await page
    .locator(".activitybar")
    .getByRole("button", {
      name: "Search",
      exact: true,
    })
    .click();

  const searchInput = page.locator(".search-input");
  await expect(searchInput).toBeVisible();
  await expect(searchInput).toHaveAttribute("placeholder", "Search files");
  await expect(searchInput).toHaveCSS("font-size", "13px");

  await searchInput.fill("Model");
  await expect(page.locator(".search-result")).toContainText("/Model.ili");
});

test("labels top-bar actions by their behavior", async ({ page }) => {
  await page.goto("./");
  const menubar = page.locator(".menubar");

  await expect(
    menubar.getByRole("button", { name: "New Model", exact: true }),
  ).toBeVisible();
  await expect(
    menubar.getByRole("button", { name: "Search", exact: true }),
  ).toBeVisible();
  await expect(
    menubar.getByRole("button", { name: "Commands…", exact: true }),
  ).toBeVisible();
  await expect(
    menubar.getByRole("button", { name: "Compile", exact: true }),
  ).toBeVisible();

  await menubar.getByRole("button", { name: "New Model", exact: true }).click();
  await expect(page.locator("#tabs")).toContainText("Untitled-1.ili");

  await menubar.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.locator("#sidebar-title")).toHaveText("SEARCH");
  await expect(page.locator(".search-input")).toBeVisible();

  await menubar.getByRole("button", { name: "Commands…", exact: true }).click();
  await expect(page.locator("#quick-pick")).toBeVisible();
  await page.keyboard.press("Escape");

  await menubar.getByRole("button", { name: "Compile", exact: true }).click();
  await expect(page.locator("#compile-status")).toContainText("compiled");
});

test("renders the semantic outline and keeps the UML at native scale", async ({
  page,
}) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Compile", exact: true }).click();
  const diagram = page.getByRole("region", {
    name: "Live INTERLIS diagram",
  });
  const svg = diagram.locator("svg");
  await expect(svg).toBeVisible();
  const autoLayout = diagram.getByRole("button", {
    name: "Auto-layout",
    exact: true,
  });
  await expect(autoLayout).toHaveCSS("font-size", "12px");
  await expect(autoLayout).toHaveCSS("color", "rgb(150, 150, 150)");
  await expect(autoLayout.locator(".codicon")).toHaveCSS("font-size", "14px");
  await autoLayout.hover();
  await expect(autoLayout).toHaveCSS("color", "rgb(204, 204, 204)");

  const dimensions = await svg.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      renderedWidth: rect.width,
      renderedHeight: rect.height,
      width: Number(element.getAttribute("width")),
      height: Number(element.getAttribute("height")),
    };
  });
  expect(dimensions.renderedWidth).toBe(dimensions.width);
  expect(dimensions.renderedHeight).toBe(dimensions.height);

  await page.getByRole("button", { name: "Outline", exact: true }).click();
  const tree = page.getByRole("tree", { name: "Document symbols" });
  await expect(tree).toBeVisible();
  await expect(tree.locator(".outline-name").first()).toHaveCSS(
    "font-size",
    "13px",
  );
  await expect(tree.locator(".outline-item")).toHaveCount(4);
  await expect(
    tree.getByRole("button", { name: "NewModel MODEL", exact: true }),
  ).toBeVisible();
  await expect(
    tree.getByRole("button", { name: "Catalog TOPIC", exact: true }),
  ).toBeVisible();
  await expect(
    tree.getByRole("button", { name: "Item CLASS", exact: true }),
  ).toBeVisible();
  await expect(
    tree.getByRole("button", { name: "Name", exact: true }),
  ).toBeVisible();
  await expect(tree.locator(".codicon-symbol-property")).toBeVisible();

  await tree.getByRole("button", { name: "Name", exact: true }).click();
  await expect(page.locator("#cursor-status")).toHaveText("Ln 5, Col 7");
  await expect(
    tree.locator('[role="treeitem"][aria-level="4"]'),
  ).toHaveAttribute("aria-selected", "true");
  await page
    .getByRole("button", {
      name: "Collapse all outline symbols",
      exact: true,
    })
    .click();
  await expect(
    tree.locator('[role="treeitem"][aria-level="1"]'),
  ).toHaveAttribute("aria-expanded", "false");

  await page
    .getByRole("separator", { name: "Resize auxiliary editor" })
    .press("ArrowLeft");
  const resizedDimensions = await svg.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  expect(resizedDimensions).toEqual({
    width: dimensions.width,
    height: dimensions.height,
  });

  await diagram
    .getByRole("button", { name: "Close UML diagram", exact: true })
    .click();
  await expect(diagram).toBeHidden();
  await page.reload();
  await expect(diagram).toBeHidden();
});

test("zooms and pans the UML diagram with mouse controls", async ({ page }) => {
  await page.goto("./");
  const diagram = page.getByRole("region", {
    name: "Live INTERLIS diagram",
  });
  const viewport = diagram.locator(".diagram-viewport");
  const svg = diagram.locator("svg");
  await expect(svg).toBeVisible();

  const box = await viewport.boundingBox();
  if (!box) throw new Error("Diagram viewport has no bounding box");
  const cursor = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
  const base = await svg.evaluate((element) => {
    const svgElement = element as SVGSVGElement;
    const rect = svgElement.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      viewBox: svgElement.viewBox.baseVal,
    };
  });
  const worldAtCursor = () =>
    page.evaluate(({ x, y }) => {
      const viewportElement =
        document.querySelector<HTMLElement>(".diagram-viewport");
      const diagramElement =
        viewportElement?.querySelector<SVGSVGElement>("svg");
      if (!viewportElement || !diagramElement)
        throw new Error("Diagram elements are unavailable");
      const rect = diagramElement.getBoundingClientRect();
      const viewBox = diagramElement.viewBox.baseVal;
      return {
        x: ((x - rect.left) / rect.width) * viewBox.width + viewBox.x,
        y: ((y - rect.top) / rect.height) * viewBox.height + viewBox.y,
      };
    }, cursor);

  const beforeWorld = await worldAtCursor();
  await page.mouse.move(cursor.x, cursor.y);
  await page.mouse.wheel(0, -120);
  await expect
    .poll(() =>
      svg.evaluate((element) => element.getBoundingClientRect().width),
    )
    .toBeCloseTo(base.width * 1.1, 1);
  const afterWorld = await worldAtCursor();
  expect(afterWorld.x).toBeCloseTo(beforeWorld.x, 1);
  expect(afterWorld.y).toBeCloseTo(beforeWorld.y, 1);

  await page.mouse.wheel(0, 120);
  await expect
    .poll(() =>
      svg.evaluate((element) => element.getBoundingClientRect().width),
    )
    .toBeCloseTo(base.width, 1);

  for (let index = 0; index < 20; index += 1) await page.mouse.wheel(0, -120);
  await expect
    .poll(() =>
      svg.evaluate((element) => element.getBoundingClientRect().width),
    )
    .toBeCloseTo(base.width * 3, 1);

  for (let index = 0; index < 40; index += 1) await page.mouse.wheel(0, 120);
  await expect
    .poll(() =>
      svg.evaluate((element) => element.getBoundingClientRect().width),
    )
    .toBeCloseTo(base.width * 0.25, 1);

  for (let index = 0; index < 20; index += 1) await page.mouse.wheel(0, -120);
  const beforePan = await viewport.evaluate((element) => ({
    scrollLeft: element.scrollLeft,
    scrollTop: element.scrollTop,
  }));
  await page.mouse.move(cursor.x, cursor.y);
  await page.mouse.down({ button: "middle" });
  await expect(viewport).toHaveClass(/is-panning/u);
  await page.mouse.move(cursor.x - 100, cursor.y - 80);
  await page.mouse.up({ button: "middle" });
  await expect(viewport).not.toHaveClass(/is-panning/u);
  const afterPan = await viewport.evaluate((element) => ({
    scrollLeft: element.scrollLeft,
    scrollTop: element.scrollTop,
  }));
  expect(afterPan.scrollLeft).toBeGreaterThan(beforePan.scrollLeft);
  expect(afterPan.scrollTop).toBeGreaterThan(beforePan.scrollTop);

  const beforeRefresh = await viewport.evaluate((element) => ({
    zoom: Number(element.dataset.zoom),
    scrollLeft: element.scrollLeft,
    scrollTop: element.scrollTop,
  }));
  await diagram
    .getByRole("button", { name: "Auto-layout", exact: true })
    .click();
  await page.waitForTimeout(250);
  const afterRefresh = await viewport.evaluate((element) => ({
    zoom: Number(element.dataset.zoom),
    scrollLeft: element.scrollLeft,
    scrollTop: element.scrollTop,
  }));
  expect(afterRefresh.zoom).toBeCloseTo(beforeRefresh.zoom, 5);
  expect(afterRefresh.scrollLeft).toBeCloseTo(beforeRefresh.scrollLeft, 0);
  expect(afterRefresh.scrollTop).toBeCloseTo(beforeRefresh.scrollTop, 0);
});

test("keeps UML node double-click navigation intact", async ({ page }) => {
  await page.goto("./");
  const diagram = page.getByRole("region", {
    name: "Live INTERLIS diagram",
  });
  const classNode = diagram.locator(".ili-node.ili-class");
  await expect(classNode).toHaveCount(1);
  await classNode.dblclick();
  await expect(page.locator("#cursor-status")).not.toHaveText("Ln 1, Col 1");
});

test("closes dirty tabs safely from tabs and Open Editors", async ({
  page,
}) => {
  await page.goto("./");
  await page.getByRole("button", { name: "New file", exact: true }).click();

  const tabs = page.locator("#tabs");
  const openEditors = page.locator(".open-editors");
  await expect(
    tabs.getByRole("button", { name: "Untitled-1.ili", exact: true }),
  ).toBeVisible();
  await expect(
    openEditors.getByRole("button", {
      name: "Close Untitled-1.ili",
      exact: true,
    }),
  ).toBeVisible();

  const tab = tabs.locator(".tab").filter({ hasText: "Untitled-1.ili" });
  const tabClose = tab.locator(".tab-close");
  await expect(tabClose.locator(".codicon-close-dirty")).toBeVisible();
  await expect(tabClose.locator(".codicon-close")).toBeHidden();
  await tab.locator(".tab-label").focus();
  await page.keyboard.press("Tab");
  await expect(tabClose).toBeFocused();
  await expect(tabClose.locator(".codicon-close-dirty")).toBeHidden();
  await expect(tabClose.locator(".codicon-close")).toBeVisible();
  await tab.hover();
  await expect(tabClose.locator(".codicon-close-dirty")).toBeHidden();
  await expect(tabClose.locator(".codicon-close")).toBeVisible();

  await tabs
    .getByRole("button", {
      name: "Close Untitled-1.ili",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", { name: "Save changes?" });
  await expect(dialog).toBeVisible();
  for (const buttonName of ["Save", "Don't Save", "Cancel"]) {
    await expect(
      dialog.getByRole("button", { name: buttonName, exact: true }),
    ).toHaveCSS("font-size", "13px");
  }
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    tabs.getByRole("button", { name: "Untitled-1.ili", exact: true }),
  ).toBeVisible();

  const openEditor = openEditors
    .locator(".open-editor-row")
    .filter({ hasText: "Untitled-1.ili" });
  const openEditorClose = openEditor.locator(".open-editor-close");
  await expect(openEditorClose.locator(".codicon-close-dirty")).toBeVisible();
  await expect(openEditorClose.locator(".codicon-close")).toBeHidden();
  await openEditor.locator(".open-editor-label").focus();
  await page.keyboard.press("Tab");
  await expect(openEditorClose).toBeFocused();
  await expect(openEditorClose.locator(".codicon-close-dirty")).toBeHidden();
  await expect(openEditorClose.locator(".codicon-close")).toBeVisible();
  await openEditor.hover();
  await expect(openEditorClose.locator(".codicon-close-dirty")).toBeHidden();
  await expect(openEditorClose.locator(".codicon-close")).toBeVisible();

  await openEditors
    .getByRole("button", {
      name: "Close Untitled-1.ili",
      exact: true,
    })
    .click();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    tabs.getByRole("button", { name: "Untitled-1.ili", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .locator(".file-tree")
      .getByRole("button", { name: "Untitled-1.ili", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "New file", exact: true }).click();
  await page.waitForTimeout(350);
  await tabs
    .getByRole("button", {
      name: "Close Untitled-2.ili",
      exact: true,
    })
    .click();
  await dialog.getByRole("button", { name: "Don't Save", exact: true }).click();
  await expect(
    tabs.getByRole("button", { name: "Untitled-2.ili", exact: true }),
  ).toHaveCount(0);
  await expect(
    tabs.getByRole("button", { name: "Model.ili", exact: true }),
  ).toBeVisible();
});

test("resizes and persists all three workbench separators", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Layout interaction smoke runs once");
  await page.goto("./");

  const sidebar = page.locator(".sidebar");
  const sidebarSeparator = page.getByRole("separator", {
    name: "Resize side bar",
  });
  const sidebarBefore = await sidebar.evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  const separatorBox = await sidebarSeparator.boundingBox();
  if (!separatorBox) throw new Error("Sidebar separator has no box");
  await page.mouse.move(
    separatorBox.x + separatorBox.width / 2,
    separatorBox.y + separatorBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(separatorBox.x + 42, separatorBox.y + 20);
  await page.mouse.up();
  const sidebarAfter = await sidebar.evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  expect(sidebarAfter).toBeGreaterThan(sidebarBefore + 25);

  const diagram = page.getByRole("region", {
    name: "Live INTERLIS diagram",
  });
  const diagramBefore = await diagram.evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  await page
    .getByRole("separator", { name: "Resize auxiliary editor" })
    .press("ArrowLeft");
  const diagramAfter = await diagram.evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  expect(diagramAfter).toBeGreaterThan(diagramBefore);

  const panel = page.locator("#panel");
  const panelBefore = await panel.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  await page.getByRole("separator", { name: "Resize panel" }).press("ArrowUp");
  const panelAfter = await panel.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  expect(panelAfter).toBeGreaterThan(panelBefore);

  const storedRaw = await page.evaluate(() =>
    localStorage.getItem("interlis-web-ide.layout-settings"),
  );
  const stored: unknown = JSON.parse(storedRaw ?? "{}");
  expect(stored).toMatchObject({
    version: 1,
    diagramVisible: true,
  });
  expect(stored).toEqual(
    expect.objectContaining({
      sidebarWidth: expect.any(Number),
      auxiliaryRatio: expect.any(Number),
      panelHeight: expect.any(Number),
    }),
  );
  const layout = stored as Record<string, unknown>;
  expect(layout.sidebarWidth).toEqual(expect.any(Number));
  expect(layout.auxiliaryRatio).toEqual(expect.any(Number));
  expect(layout.panelHeight).toEqual(expect.any(Number));
  expect(layout.sidebarWidth as number).toBeGreaterThan(sidebarBefore);
  expect(layout.auxiliaryRatio as number).toBeGreaterThan(0.5);
  expect(layout.panelHeight as number).toBeGreaterThan(180);

  await page.reload();
  await expect
    .poll(() =>
      sidebar.evaluate((element) => element.getBoundingClientRect().width),
    )
    .toBeCloseTo(sidebarAfter, 0);
});
