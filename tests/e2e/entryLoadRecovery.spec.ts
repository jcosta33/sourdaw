import { expect, test, type Page, type Route } from '@playwright/test';

import vercelConfig from '../../vercel.json' with { type: 'json' };

import { enable_direct_e2e_viewport, launch_new_project, LAUNCH_SCREEN_NAME, setupWorkspace } from './e2eUtils';

// The private per-tab budget in public/entryLoadRecovery.js.
const RETRY_KEY = 'sourdaw:entry-load-retry-v1';

async function readEntryUrl(page: Page): Promise<string> {
    const response = await page.request.get('/');
    expect(response.ok()).toBe(true);
    const html = await response.text();
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)]
        .map(([tag]) => ({
            type: /\btype=["']([^"']+)["']/.exec(tag)?.[1],
            src: /\bsrc=["']([^"']+)["']/.exec(tag)?.[1],
        }))
        .filter((script) => script.type === 'module' && script.src !== undefined);
    const entry = scripts.at(-1)?.src;
    if (entry === undefined) {
        throw new Error('Served HTML has no external module entry');
    }
    return new URL(entry, response.url()).href;
}

async function abortParsedEntry(route: Route, entryUrl: string): Promise<void> {
    // The speculative scanner can fetch before its module element is parsed.
    // Fail the pending request only once its real script element owns that fetch.
    await route
        .request()
        .frame()
        .waitForFunction((url) => [...document.scripts].some((script) => script.src === url), entryUrl, {
            timeout: 10_000,
        });
    await route.abort('aborted');
}

test('recovers when the actual entry request is aborted once', async ({ page }, testInfo) => {
    await enable_direct_e2e_viewport(page);
    const entryUrl = await readEntryUrl(page);
    let attempts = 0;
    let firstTimeOrigin: number | undefined;
    const failures: Array<{ url: string; error: string | undefined }> = [];
    page.on('requestfailed', (request) => {
        if (request.url() === entryUrl) {
            failures.push({ url: request.url(), error: request.failure()?.errorText });
        }
    });
    await page.route(entryUrl, async (route) => {
        attempts += 1;
        if (attempts === 1) {
            firstTimeOrigin = await route
                .request()
                .frame()
                .evaluate(() => performance.timeOrigin);
            await abortParsedEntry(route, entryUrl);
            return;
        }
        await route.continue();
    });

    try {
        await page.goto('/', { waitUntil: 'commit' });
        await expect.poll(() => failures.length).toBe(1);
        expect(failures[0]?.error).toContain('ERR_ABORTED');
        await expect(page.getByLabel(LAUNCH_SCREEN_NAME)).toBeVisible({ timeout: 15_000 });
        expect(attempts).toBe(2);
        expect(firstTimeOrigin).toBeDefined();
        expect(await page.evaluate(() => performance.timeOrigin)).not.toBe(firstTimeOrigin);
    } finally {
        await testInfo.attach('entry-attempts', {
            body: JSON.stringify({ attempts, failures, root: await page.locator('#root').innerHTML() }),
            contentType: 'application/json',
        });
    }
});

test('persistent entry failure stops after one retry and manual Reload preserves the full URL', async ({ page }) => {
    await enable_direct_e2e_viewport(page);
    const entryUrl = await readEntryUrl(page);
    let attempts = 0;
    await page.route(entryUrl, async (route) => {
        attempts += 1;
        await abortParsedEntry(route, entryUrl);
    });
    await page.goto('/?entry-recovery=query#entry-recovery', { waitUntil: 'commit' });
    const failure = page.getByRole('alert', { name: 'Sourdaw could not start' });
    await expect(failure).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(attempts).toBe(2);
    const url = page.url();
    expect(new URL(url).search).toBe('?entry-recovery=query');
    expect(new URL(url).hash).toBe('#entry-recovery');
    expect(await page.evaluate((key) => sessionStorage.getItem(key), RETRY_KEY)).toBe('used');

    await failure.getByRole('button', { name: 'Reload Sourdaw' }).click();
    await expect.poll(() => attempts).toBe(3);
    await expect(failure).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(attempts).toBe(3);
    expect(page.url()).toBe(url);
});

test('a pending recovery controller leaves fallback readable and catches an already failed entry after release', async ({
    page,
}) => {
    await enable_direct_e2e_viewport(page);
    const entryUrl = await readEntryUrl(page);
    let releaseController = (): void => undefined;
    const controllerAllowed = new Promise<void>((resolve) => {
        releaseController = resolve;
    });
    let controllerPending = false;
    let entryAttempts = 0;
    let firstTimeOrigin: number | undefined;
    const entryFailures: string[] = [];
    page.on('requestfailed', (request) => {
        if (request.url() === entryUrl) {
            entryFailures.push(request.failure()?.errorText ?? 'unknown failure');
        }
    });
    await page.route('**/entryLoadRecovery.js', async (route) => {
        controllerPending = true;
        await controllerAllowed;
        controllerPending = false;
        await route.continue();
    });
    await page.route(entryUrl, async (route) => {
        entryAttempts += 1;
        if (entryAttempts === 1) {
            firstTimeOrigin = await route
                .request()
                .frame()
                .evaluate(() => performance.timeOrigin);
            await abortParsedEntry(route, entryUrl);
            return;
        }
        await route.continue();
    });
    try {
        await page.goto('/', { waitUntil: 'commit' });
        await expect(page.getByRole('status', { name: 'Starting Sourdaw' })).toBeVisible();
        await expect(
            page.getByText("If this screen remains, use your browser's Reload to try starting Sourdaw again.")
        ).toBeVisible();
        await expect.poll(() => entryFailures).toEqual(['net::ERR_ABORTED']);
        expect(controllerPending).toBe(true);
        expect(entryAttempts).toBe(1);
        expect(await page.evaluate((key) => sessionStorage.getItem(key), RETRY_KEY)).toBeNull();
        expect(await page.evaluate(() => document.documentElement.hasAttribute('data-sourdaw-entry-started'))).toBe(
            false
        );

        releaseController();
        await expect(page.getByLabel(LAUNCH_SCREEN_NAME)).toBeVisible({ timeout: 15_000 });
        expect(firstTimeOrigin).toBeDefined();
        expect(await page.evaluate(() => performance.timeOrigin)).not.toBe(firstTimeOrigin);
        expect(entryAttempts).toBe(2);
        expect(await page.evaluate((key) => sessionStorage.getItem(key), RETRY_KEY)).toBe('used');
    } finally {
        releaseController();
    }
});

test('an unrelated script error before entry execution cannot consume the retry budget', async ({ page }) => {
    await enable_direct_e2e_viewport(page);
    const entryUrl = await readEntryUrl(page);
    let releaseEntry = (): void => undefined;
    const entryAllowed = new Promise<void>((resolve) => {
        releaseEntry = resolve;
    });
    await page.route(entryUrl, async (route) => {
        await entryAllowed;
        await route.continue();
    });
    try {
        await page.goto('/', { waitUntil: 'commit' });
        await expect(page.getByRole('status', { name: 'Starting Sourdaw' })).toBeVisible();
        const before = await page.evaluate(() => performance.timeOrigin);
        const budget = await page.evaluate((key) => {
            const controller = document.querySelector('script[src$="/entryLoadRecovery.js"]');
            if (controller === null) {
                throw new Error('Independent recovery controller is missing');
            }
            controller.dispatchEvent(new Event('error'));
            return sessionStorage.getItem(key);
        }, RETRY_KEY);
        expect(budget).toBeNull();
        releaseEntry();
        await expect(page.getByLabel(LAUNCH_SCREEN_NAME)).toBeVisible({ timeout: 15_000 });
        expect(await page.evaluate(() => performance.timeOrigin)).toBe(before);
    } finally {
        releaseEntry();
    }
});

for (const storageState of ['unavailable', 'corrupt', 'unwritable'] as const) {
    test(`entry failure requires manual Reload when retry storage is ${storageState}`, async ({ page }) => {
        await enable_direct_e2e_viewport(page);
        await page.addInitScript(
            ({ state, key }) => {
                if (state === 'unavailable') {
                    Object.defineProperty(window, 'sessionStorage', {
                        get() {
                            throw new DOMException('Storage disabled', 'SecurityError');
                        },
                    });
                } else if (state === 'corrupt') {
                    sessionStorage.setItem(key, 'invalid');
                } else {
                    Storage.prototype.setItem = () => {
                        throw new DOMException('Storage full', 'QuotaExceededError');
                    };
                }
            },
            { state: storageState, key: RETRY_KEY }
        );
        const entryUrl = await readEntryUrl(page);
        let attempts = 0;
        await page.route(entryUrl, async (route) => {
            attempts += 1;
            await abortParsedEntry(route, entryUrl);
        });
        await page.goto('/', { waitUntil: 'commit' });
        await expect(page.getByRole('alert', { name: 'Sourdaw could not start' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Reload Sourdaw' })).toBeVisible();
        await page.waitForLoadState('networkidle');
        expect(attempts).toBe(1);
    });
}

test('a late entry error leaves the running project and document intact', async ({ page }) => {
    const entryUrl = await readEntryUrl(page);
    await setupWorkspace(page);
    await launch_new_project(page);
    await page.getByTestId('project-name').click();
    const name = page.locator('input:focus');
    await name.fill('Keep this running project');
    await name.press('Enter');
    await expect(page.getByTestId('project-name')).toHaveText('Keep this running project');
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);

    await page.evaluate((url) => {
        const entry = [...document.scripts].find((script) => script.src === url);
        if (entry === undefined) {
            throw new Error('The actual entry script is missing');
        }
        entry.dispatchEvent(new Event('error'));
    }, entryUrl);

    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
    await expect(page.getByTestId('project-name')).toHaveText('Keep this running project');
    await expect(page.getByRole('alert', { name: 'Sourdaw could not start' })).toHaveCount(0);
    expect(await page.evaluate((key) => sessionStorage.getItem(key), RETRY_KEY)).toBeNull();
});

test('a failed child entry retries only the child and shares its budget with the host', async ({ page }) => {
    const entryUrl = await readEntryUrl(page);
    let hostAttempts = 0;
    let childAttempts = 0;
    await page.route(entryUrl, async (route) => {
        if (route.request().frame() === page.mainFrame()) {
            hostAttempts += 1;
            await route.continue();
            return;
        }
        childAttempts += 1;
        await abortParsedEntry(route, entryUrl);
    });
    await page.goto('/', { waitUntil: 'commit' });
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    const child = page.frameLocator('iframe[title="Sourdaw"]');
    const failure = child.getByRole('alert', { name: 'Sourdaw could not start' });
    await expect(failure).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect({ hostAttempts, childAttempts }).toEqual({ hostAttempts: 1, childAttempts: 2 });
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
    expect(await page.evaluate((key) => sessionStorage.getItem(key), RETRY_KEY)).toBe('used');

    await failure.getByRole('button', { name: 'Reload Sourdaw' }).click();
    await expect.poll(() => childAttempts).toBe(3);
    await expect(failure).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect({ hostAttempts, childAttempts }).toEqual({ hostAttempts: 1, childAttempts: 3 });
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
});

test('a host retry exhausts the same tab budget before a child entry fails', async ({ page }) => {
    const entryUrl = await readEntryUrl(page);
    let hostAttempts = 0;
    let childAttempts = 0;
    await page.route(entryUrl, async (route) => {
        if (route.request().frame() === page.mainFrame()) {
            hostAttempts += 1;
            if (hostAttempts === 2) {
                await route.continue();
                return;
            }
        } else {
            childAttempts += 1;
        }
        await abortParsedEntry(route, entryUrl);
    });
    await page.goto('/', { waitUntil: 'commit' });
    await expect(
        page.frameLocator('iframe[title="Sourdaw"]').getByRole('alert', { name: 'Sourdaw could not start' })
    ).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect({ hostAttempts, childAttempts }).toEqual({ hostAttempts: 2, childAttempts: 1 });
});

test('the independent recovery controller works under the production content security policy', async ({ page }) => {
    await enable_direct_e2e_viewport(page);
    const csp = vercelConfig.headers
        .flatMap((rule) => rule.headers)
        .find((header) => header.key === 'Content-Security-Policy');
    if (csp === undefined) {
        throw new Error('Production Content-Security-Policy is missing');
    }
    await page.route(
        (url) => url.pathname === '/',
        async (route) => {
            const response = await route.fetch();
            await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp.value } });
        }
    );
    const entryUrl = await readEntryUrl(page);
    let attempts = 0;
    await page.route(entryUrl, async (route) => {
        attempts += 1;
        await abortParsedEntry(route, entryUrl);
    });
    await page.goto('/', { waitUntil: 'commit' });
    await expect(page.getByRole('alert', { name: 'Sourdaw could not start' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(attempts).toBe(2);
});

test('an unavailable recovery controller and entry still leave native browser Reload instructions', async ({
    page,
}) => {
    await enable_direct_e2e_viewport(page);
    const entryUrl = await readEntryUrl(page);
    await page.route('**/entryLoadRecovery.js', (route) => route.abort('aborted'));
    await page.route(entryUrl, (route) => abortParsedEntry(route, entryUrl));
    await page.goto('/');
    await expect(page.getByRole('status', { name: 'Starting Sourdaw' })).toBeVisible();
    await expect(
        page.getByText("If this screen remains, use your browser's Reload to try starting Sourdaw again.")
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reload Sourdaw' })).toBeHidden();
});
