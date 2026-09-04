import { chromium, type FullConfig } from '@playwright/test';

import { LAUNCH_SCREEN_NAME } from './e2eUtils';

/**
 * One-time bound for the dev server's cold module transform. Playwright's
 * `webServer.url` answers as soon as Vite serves the HTML shell, long before
 * the SPA and WASM module graph has compiled, so whichever test navigated
 * first used to absorb that compile inside its own first-paint allowance and
 * time out on cold CI hardware. This bound is paid once per run, outside every
 * test's observation window; the per-test first-paint bounds stay as they are
 * and keep measuring a warm module graph.
 */
const COLD_FIRST_PAINT_TIMEOUT_MS = 180_000;

/**
 * Global setup: navigate to the app once and wait for the launch overlay, so
 * the dev server's module graph is warm before the first test observes it.
 * The web server plugin starts (and health-checks) the server before global
 * setup runs, so the navigation always has a live origin to hit.
 */
// oxlint-disable-next-line import/no-default-export -- Playwright resolves globalSetup by default export.
export default async function warmFirstPaint(config: FullConfig): Promise<void> {
    const baseURL = config.projects[0]?.use.baseURL;
    if (baseURL === undefined) {
        throw new Error('First-paint warmup requires the project baseURL naming the app server');
    }

    const browser = await chromium.launch();
    try {
        const page = await browser.newPage({ baseURL });
        // Direct composition, as in e2eUtils: the launch overlay then renders
        // in the main frame instead of inside the display-scale host iframe.
        await page.addInitScript(() => {
            window.name = 'sourdaw-e2e-direct';
        });
        await page.goto('/');
        await page.getByLabel(LAUNCH_SCREEN_NAME).waitFor({ state: 'visible', timeout: COLD_FIRST_PAINT_TIMEOUT_MS });
    } finally {
        await browser.close();
    }
}
