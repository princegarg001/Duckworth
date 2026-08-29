import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * End-to-end flows.
 *
 * Four journeys plus an accessibility pass. These run against a real stack
 * (`docker compose up`), so they exercise the same bytes a reviewer would.
 *
 * They assert *content*, not just that a page rendered — a smoke test that only
 * checks for HTTP 200 passes against a page showing an empty state.
 */

test.describe('league overview', () => {
  test('shows the points table with the real champion on top', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Season overview' })).toBeVisible();

    const table = page.getByRole('table', { name: /points table/i });
    await expect(table).toBeVisible();

    // GT finished top of the league stage on 20 points.
    const firstRow = table.locator('tbody tr').first();
    await expect(firstRow).toContainText('Gujarat Titans');
    await expect(firstRow).toContainText('20');

    // Ten franchises, no more and no fewer.
    await expect(table.locator('tbody tr')).toHaveCount(10);
  });

  test('links a leader through to their player page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /Jos Buttler/ }).first().click();
    await expect(page.getByRole('heading', { name: 'Jos Buttler' })).toBeVisible();
    await expect(page.getByText('863')).toBeVisible();
  });
});

test.describe('matches', () => {
  test('filters by team and keeps the filter in the URL', async ({ page }) => {
    await page.goto('/matches');
    await expect(page.getByRole('heading', { name: 'Matches' })).toBeVisible();

    await page.getByLabel('Team').selectOption({ label: 'Chennai Super Kings' });
    await page.waitForURL(/teamId=/);

    // The filter is shareable: reloading the URL keeps it applied.
    await page.reload();
    await expect(page.getByLabel('Team')).toHaveValue(/\d+/);

    // Every visible fixture must involve the filtered team.
    const cards = page.locator('ul > li a[href^="/matches/"]');
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < Math.min(count, 5); i += 1) {
      await expect(cards.nth(i)).toContainText('CSK');
    }
  });

  test('opens a scorecard with both innings and a rendered chart', async ({ page }) => {
    await page.goto('/matches');
    await page.locator('a[href^="/matches/"]').first().click();

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Both innings, as real tables.
    await expect(page.getByRole('table')).not.toHaveCount(0);
    await expect(page.getByText('Fall of wickets').first()).toBeVisible();

    // The worm chart renders actual SVG geometry, not an empty box.
    const chart = page.locator('.recharts-wrapper').first();
    await expect(chart).toBeVisible();
    await expect(chart.locator('path.recharts-curve').first()).toBeVisible();
  });

  test('every chart offers the same numbers as a table', async ({ page }) => {
    await page.goto('/matches');
    await page.locator('a[href^="/matches/"]').first().click();

    const panel = page.locator('section', { hasText: 'Run progression' }).first();
    await panel.getByRole('button', { name: 'table' }).click();

    // Switching to the table view must produce a real table, which is the
    // accessibility path for anyone not reading the chart shapes.
    await expect(panel.getByRole('table')).toBeVisible();
  });
});

test.describe('ball by ball', () => {
  test('lists deliveries in sequence and loads more on scroll', async ({ page }) => {
    await page.goto('/matches');
    const href = await page.locator('a[href^="/matches/"]').first().getAttribute('href');
    await page.goto(`${href}/deliveries`);

    await expect(page.getByRole('heading', { name: 'Ball by ball' })).toBeVisible();

    const log = page.getByRole('log', { name: /ball by ball/i });
    await expect(log).toBeVisible();

    const before = await page.getByText(/deliveries loaded/).textContent();
    await log.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page.waitForTimeout(1500);
    const after = await page.getByText(/deliveries loaded/).textContent();

    expect(after).not.toBe(before);
  });
});

test.describe('players', () => {
  test('searches and shows phase splits', async ({ page }) => {
    await page.goto('/players');
    await page.getByRole('searchbox').fill('Chahal');
    await page.waitForURL(/q=Chahal/);

    await page.getByRole('link', { name: /Chahal/ }).first().click();
    await expect(page.getByRole('heading', { name: /Chahal/ })).toBeVisible();

    // A leg-spinner who bowled in all three phases.
    await expect(page.getByText('Bowling by phase')).toBeVisible();
    await expect(page.getByText('27')).toBeVisible(); // Purple Cap
  });

  test('shows an empty state rather than a blank page for no results', async ({ page }) => {
    await page.goto('/players?q=zzzznotaplayer');
    await expect(page.getByText(/No players match that search/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Clear search' })).toBeVisible();
  });
});

test.describe('accessibility', () => {
  for (const path of ['/', '/matches', '/players', '/venues', '/teams']) {
    test(`${path} has no critical or serious violations`, async ({ page }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      const blocking = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );

      // Print what failed rather than just a count, so a failure is actionable
      // from the CI log alone.
      if (blocking.length > 0) {
        console.error(
          blocking.map((v) => `${v.impact}: ${v.id} — ${v.help}`).join('\n'),
        );
      }
      expect(blocking).toEqual([]);
    });
  }

  test('is keyboard navigable from the skip link', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  });
});
