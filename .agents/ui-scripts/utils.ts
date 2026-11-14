import { mkdtemp, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import { chromium } from 'playwright';

// Explicit .ts extension: these scripts run under Node type stripping, which
// does not resolve extensionless TypeScript imports.
import {
    assertServingCheckoutIdentity,
    e2eOrigin,
    originAnswers,
    resolveE2ePort,
} from '../../scripts/e2eServerIdentity.ts';

type BrowserProfile =
    | { mode: 'non-persistent' }
    | { mode: 'temporary-persistent'; userDataDir: string; guardTempDirectory: string; freshEmpty: true };

async function setupTemporaryPersistentBrowser(baseUrl: string, headless: boolean) {
    const tempDirectory = process.env.TMPDIR;
    if (!tempDirectory || !isAbsolute(tempDirectory) || !process.env.SOURDAW_PROCESS_SESSION) {
        throw new Error('A temporary persistent browser profile requires resourceGuard-owned TMPDIR');
    }
    const guardTempDirectory = await realpath(tempDirectory);
    const userDataDir = await mkdtemp(join(guardTempDirectory, 'sourdaw-agent-browser-profile-'));
    if ((await readdir(userDataDir)).length !== 0) {
        throw new Error('Temporary persistent browser profile must start empty');
    }
    // resourceGuard owns directory reclamation after all browser handles close.
    const context = await chromium.launchPersistentContext(userDataDir, { headless });
    try {
        const browser = context.browser();
        if (browser === null) {
            throw new TypeError('Persistent Chromium context did not expose its browser');
        }
        const page = context.pages()[0] ?? (await context.newPage());
        await page.goto(baseUrl);
        const profile: BrowserProfile = {
            mode: 'temporary-persistent',
            userDataDir,
            guardTempDirectory,
            freshEmpty: true,
        };
        return { browser, page, profile };
    } catch (error) {
        await context.close();
        throw error;
    }
}

/**
 * Set up a browser for agent UI investigations.
 * @returns The browser and page; the caller must close the browser when done.
 */
export async function setupAgentBrowser(options: { headless?: boolean; temporaryPersistentProfile?: boolean } = {}) {
    // The local dev server, configurable via BASE_URL; without it the probe
    // follows the lane-scoped SOURDAW_E2E_PORT like e2e does.
    const baseUrl = process.env.BASE_URL || e2eOrigin(resolveE2ePort(process.env.SOURDAW_E2E_PORT));

    // Refuse a dev server that belongs to another checkout before navigating;
    // when nothing answers, page.goto reports the unreachable origin as before.
    if (await originAnswers(baseUrl)) {
        await assertServingCheckoutIdentity(baseUrl, resolve(import.meta.dirname, '../..'));
    }

    if (options.temporaryPersistentProfile) {
        return setupTemporaryPersistentBrowser(baseUrl, options.headless ?? true);
    }

    const browser = await chromium.launch({ headless: options.headless ?? true });
    try {
        const context = await browser.newContext();
        const page = await context.newPage();

        await page.goto(baseUrl);

        const profile: BrowserProfile = { mode: 'non-persistent' };
        return { browser, page, profile };
    } catch (error) {
        await browser.close();
        throw error;
    }
}
