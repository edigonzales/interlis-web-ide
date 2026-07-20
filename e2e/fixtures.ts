import { expect, test as base, type BrowserContext } from "@playwright/test";

export const test = base.extend({
  context: async (
    { baseURL, browser, browserName, playwright },
    use,
    testInfo,
  ) => {
    let context: BrowserContext;
    if (browserName === "webkit") {
      // Playwright WebKit exposes OPFS only to persistent browser contexts.
      // Its OPFS is shared across profiles, so clear browser-owned test state
      // before opening the application to preserve test isolation.
      context = await playwright.webkit.launchPersistentContext(
        testInfo.outputPath("webkit-profile"),
        { baseURL, serviceWorkers: "allow" },
      );
      if (!baseURL) throw new Error("WebKit tests require a base URL");
      const setupPage = await context.newPage();
      await setupPage.goto(new URL("icon.svg", baseURL).href);
      await setupPage.evaluate(async () => {
        localStorage.clear();
        sessionStorage.clear();
        const root = await navigator.storage.getDirectory();
        const names = (
          root as FileSystemDirectoryHandle & { keys(): AsyncIterable<string> }
        ).keys();
        for await (const name of names)
          await root.removeEntry(name, { recursive: true });
        for (const registration of await navigator.serviceWorker.getRegistrations())
          await registration.unregister();
        for (const name of await caches.keys()) await caches.delete(name);
      });
      await setupPage.close();
    } else {
      context = await browser.newContext({
        baseURL,
        serviceWorkers: "allow",
      });
    }
    await use(context);
    await context.close();
  },
});

export { expect };
