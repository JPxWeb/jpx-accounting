import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/**
 * Run axe-core WCAG 2.2 AA checks on the current page.
 * Call after the page has fully loaded and settled.
 */
export async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();

  expect(results.violations).toEqual([]);
}
