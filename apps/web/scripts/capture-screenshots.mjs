#!/usr/bin/env node
// Captures the screenshots used in README.md against the live deployment.
// Not a test — a documentation tool. Re-run after a redeploy to refresh
// docs/images/*.png; commit the results.
//
//   pnpm --filter @ipl/web screenshots -- <grafana-admin-password>
//
// Lives under apps/web (rather than the top-level scripts/) so Node's ESM
// resolution finds @playwright/test in apps/web's own node_modules — an
// import from outside that tree cannot see it, pnpm's isolated node_modules
// notwithstanding whatever `cwd` a script runs from.
// Requires Playwright's Chromium browser (already a dependency of apps/web's
// e2e suite): `pnpm --filter @ipl/web exec playwright install chromium` if
// it has never been installed on this machine.

import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', '..', '..', 'docs', 'images');

const WEB_URL = 'https://ipl-web.icytree-bb74c5d4.centralindia.azurecontainerapps.io';
const API_URL = 'https://ipl-api.icytree-bb74c5d4.centralindia.azurecontainerapps.io';
const GRAFANA_URL = 'https://ipl-grafana.icytree-bb74c5d4.centralindia.azurecontainerapps.io';

const grafanaPassword = process.argv[2];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });

async function shoot(url, file, { wait = 1500 } = {}) {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(wait);
  await page.screenshot({ path: join(OUT_DIR, file) });
  await page.close();
  console.log(`captured ${file}`);
}

await shoot(`${WEB_URL}/`, 'web-home.png');
await shoot(`${WEB_URL}/matches`, 'web-matches.png');
await shoot(`${API_URL}/docs`, 'api-docs.png');

if (grafanaPassword) {
  // Grafana's dashboard grid does not reliably paint its panels in a
  // headless full-dashboard screenshot (a known class of issue with
  // react-grid-layout + ResizeObserver timing under headless Chromium) —
  // each panel's own `?viewPanel=<id>` view renders correctly and is what
  // the README actually embeds.
  const page = await context.newPage();
  await page.goto(`${GRAFANA_URL}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="user"]', 'admin');
  await page.fill('input[name="password"]', grafanaPassword);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);

  const panels = [
    { id: 1, file: 'grafana-request-rate.png' }, // Request rate by route
    { id: 3, file: 'grafana-latency.png' }, // Request latency p50/p95/p99
    { id: 9, file: 'grafana-row-counts.png' }, // Row counts (core schema)
    { id: 8, file: 'grafana-data-quality.png' }, // Data-quality checks failing
  ];
  for (const p of panels) {
    await page.goto(`${GRAFANA_URL}/d/ipl-platform/ipl-data-platform?viewPanel=${p.id}`, {
      waitUntil: 'load',
    });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: join(OUT_DIR, p.file) });
    console.log(`captured ${p.file}`);
  }
  await page.close();
} else {
  console.log('no Grafana password given — skipping Grafana panels');
}

await browser.close();
