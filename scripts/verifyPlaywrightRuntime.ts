import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const require = createRequire(import.meta.url);

function installedRuntime(): { version: string; chromiumVersion: string } {
    const packagePath = require.resolve('playwright/package.json');
    const packageData: unknown = JSON.parse(readFileSync(packagePath, 'utf8'));
    if (
        typeof packageData !== 'object' ||
        packageData === null ||
        !('version' in packageData) ||
        typeof packageData.version !== 'string'
    ) {
        throw new Error('Resolved Playwright package has no version');
    }
    const corePackagePath = createRequire(packagePath).resolve('playwright-core/package.json');
    const manifestPath = join(dirname(corePackagePath), 'browsers.json');
    const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (
        typeof manifest === 'object' &&
        manifest !== null &&
        'browsers' in manifest &&
        Array.isArray(manifest.browsers)
    ) {
        const browsers: readonly unknown[] = manifest.browsers;
        for (const browser of browsers) {
            if (
                typeof browser === 'object' &&
                browser !== null &&
                'name' in browser &&
                browser.name === 'chromium' &&
                'browserVersion' in browser &&
                typeof browser.browserVersion === 'string'
            ) {
                return { version: packageData.version, chromiumVersion: browser.browserVersion };
            }
        }
    }
    throw new Error('Resolved Playwright package has no Chromium version');
}

type BrowserRuntime = { version: () => string; close: () => Promise<void> };

export async function verifyPlaywrightRuntime(
    imageVersion: string,
    launchChromium: () => Promise<BrowserRuntime> = () => chromium.launch()
): Promise<string> {
    const installed = installedRuntime();
    if (installed.version !== imageVersion) {
        throw new Error(`Playwright image ${imageVersion} does not match resolved package ${installed.version}`);
    }
    const browser = await launchChromium();
    try {
        const version = browser.version();
        if (version !== installed.chromiumVersion) {
            throw new Error(
                `Chromium ${version} does not match resolved Playwright browser ${installed.chromiumVersion}`
            );
        }
        return `Preinstalled Playwright ${installed.version} launched Chromium ${version}`;
    } finally {
        await browser.close();
    }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
    try {
        console.log(await verifyPlaywrightRuntime(process.argv[2] ?? ''));
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}
