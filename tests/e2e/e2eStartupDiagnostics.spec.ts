import { rm } from 'node:fs/promises';

import { createFixture, deferred, event } from '../../scripts/__tests__/fixtures/e2eStartupDiagnostics.ts';

import { test, expect } from './e2eTest';
import { enable_direct_e2e_viewport, PREFERENCES_STORAGE_KEY, wait_for_launch_first_paint } from './e2eUtils';

test('applies the persisted Light theme before the real entry module paints', async ({ page }) => {
    await enable_direct_e2e_viewport(page);
    const response = await page.request.get('/');
    expect(response.ok()).toBe(true);
    const entrySource = await page.evaluate(
        (html) => {
            const document = new DOMParser().parseFromString(html, 'text/html');
            return [...document.querySelectorAll('script[type="module" i][src]')].at(-1)?.getAttribute('src') ?? null;
        },
        await response.text()
    );
    if (entrySource === null) {
        throw new Error('Served HTML has no entry module');
    }
    const entryUrl = new URL(entrySource, response.url()).href;
    const gate = deferred<string>();
    let prepaintRequests = 0;
    let entryRequests = 0;
    await page.addInitScript((key) => {
        window.localStorage.setItem(key, JSON.stringify({ json: { theme: 'light' } }));
    }, PREFERENCES_STORAGE_KEY);
    await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/themePrepaint.js') {
            prepaintRequests += 1;
        }
        if (route.request().url() === entryUrl) {
            entryRequests += 1;
            await gate.promise;
        }
        await route.continue();
    });

    try {
        await page.goto('/', { waitUntil: 'commit' });
        await expect.poll(() => prepaintRequests).toBe(1);
        await expect.poll(() => entryRequests).toBe(1);
        await expect(page.locator('html')).toHaveClass('light');
        await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
        await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#ded8cf');
        await expect(page.locator('#entry-startup')).toHaveCSS('background-color', 'rgb(222, 216, 207)');
        expect(entryRequests).toBe(1);

        gate.resolve('release entry');
        await wait_for_launch_first_paint(page);
    } finally {
        gate.resolve('release entry');
        await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
});

test('receives independent renderer heartbeats while the real entry module remains held', async ({ page }) => {
    const gate = deferred<string>();
    const item = await createFixture('e2e', gate);
    try {
        const response = await page.goto(item.origin, { waitUntil: 'commit' });
        expect(response?.headers()['content-security-policy']).toBe(
            "default-src 'self'; script-src 'self'; connect-src 'self'"
        );
        await expect.poll(() => event(item, 'transform-start')).toBeDefined();
        await expect
            .poll(() => item.events.filter((value) => value.event === 'renderer-heartbeat').length, {
                timeout: 8_000,
            })
            .toBeGreaterThan(1);
        expect(event(item, 'transform-resolve')).toBeUndefined();
        expect(event(item, 'renderer-heartbeat')).toMatchObject({
            entryStarted: false,
            bootstrapStarted: false,
            appRenderIssued: false,
            retryIssued: false,
        });
        expect(event(item, 'server-heartbeat')).toBeDefined();
        gate.resolve('export const fixtureValue = 23;');
        await page.waitForFunction(() => document.documentElement.dataset.fixtureReady === 'yes');
        await expect.poll(() => event(item, 'http-finish')).toMatchObject({ status: 200 });
    } finally {
        gate.resolve('export const fixtureValue = 23;');
        await page.close();
        await item.server.close();
        await rm(item.root, { recursive: true, force: true });
    }
});
