import { AxeBuilder } from '@axe-core/playwright';
import { Page, expect } from '@playwright/test';

export interface A11yOptions {
  /** Disable specific axe rules (e.g. 'color-contrast' in headless). */
  disabledRules?: string[];
  /** Limit the audit to a subset of tags (default: wcag2a, wcag2aa). */
  tags?: string[];
}

/**
 * Run axe-core against the current page and assert zero violations on
 * critical pages. Returns the raw results for advanced assertions.
 */
export async function assertNoA11yViolations(
  page: Page,
  options: A11yOptions = {},
): Promise<void> {
  const builder = new AxeBuilder({ page }).withTags(
    options.tags ?? ['wcag2a', 'wcag2aa'],
  );
  if (options.disabledRules?.length) {
    builder.disableRules(options.disabledRules);
  }
  const results = await builder.analyze();
  if (results.violations.length > 0) {
    // Surface a compact summary to make failures debuggable.
    const summary = results.violations
      .map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`)
      .join('\n');
    throw new Error(`Accessibility violations found:\n${summary}`);
  }
  expect(results.violations).toEqual([]);
}
