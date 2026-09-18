import { resolve } from 'node:path';

import { chromium } from 'playwright';

// Explicit .ts extension: these scripts run under Node type stripping, which
// does not resolve extensionless TypeScript imports.
import {
    assertServingCheckoutIdentity,
    e2eOrigin,
    originAnswers,
    resolveE2ePort,
} from '../../scripts/e2eServerIdentity.ts';

/**
 * Setup a headless browser for agent UI investigations.
 * @returns A tuple of [browser, page] that the caller must close when done.
 */
export async function setupAgentBrowser() {
    // The local dev server, configurable via BASE_URL; without it the probe
    // follows the lane-scoped SOURDAW_E2E_PORT like e2e does.
    const baseUrl = process.env.BASE_URL || e2eOrigin(resolveE2ePort(process.env.SOURDAW_E2E_PORT));

    // Refuse a dev server that belongs to another checkout before navigating;
    // when nothing answers, page.goto reports the unreachable origin as before.
    if (await originAnswers(baseUrl)) {
        await assertServingCheckoutIdentity(baseUrl, resolve(import.meta.dirname, '../..'));
    }

    const browser = await chromium.launch();
    try {
        const context = await browser.newContext();
        const page = await context.newPage();

        await page.goto(baseUrl);

        return { browser, page };
    } catch (error) {
        await browser.close();
        throw error;
    }
}
