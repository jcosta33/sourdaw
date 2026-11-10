import { rm } from 'node:fs/promises';

import { createFixture, deferred, event } from '../../scripts/__tests__/fixtures/e2eStartupDiagnostics.ts';

import { test, expect } from './e2eTest';
import {
    enable_direct_e2e_viewport,
    LAUNCH_SCREEN_FIRST_PAINT_TIMEOUT_MS,
    LAUNCH_SCREEN_NAME,
    PREFERENCES_STORAGE_KEY,
    wait_for_launch_first_paint,
} from './e2eUtils';

test('applies the persisted Light theme before the real entry module paints', async ({ page }) => {
    await enable_direct_e2e_viewport(page);
    const response = await page.request.get('/');
    expect(response.ok()).toBe(true);
    const { entrySource, decoyEntrySources } = await page.evaluate(
        (html) => {
            const discoverEntry = (sourceHtml: string): string | null => {
                const document = window.document.implementation.createHTMLDocument('');
                document.open();
                document.write(sourceHtml);
                document.close();
                const modules = [...document.querySelectorAll('script[type="module" i][src]')].filter(
                    (script) => script.namespaceURI === 'http://www.w3.org/1999/xhtml'
                );
                const developmentEntries = modules.filter((script) => script.id === 'sourdaw-entry');
                if (developmentEntries.length > 0) {
                    if (
                        developmentEntries.length !== 1 ||
                        developmentEntries[0]?.getAttribute('src') !== '/src/app/main.tsx'
                    ) {
                        throw new Error('Served development HTML must have exactly one real entry module');
                    }
                    return developmentEntries[0]?.getAttribute('src') ?? null;
                }
                const builtEntries = modules.filter(
                    (script) =>
                        script.hasAttribute('crossorigin') &&
                        /^\.\/assets\/index-[A-Za-z0-9_-]+\.js$/u.test(script.getAttribute('src') ?? '')
                );
                if (builtEntries.length !== 1) {
                    throw new Error('Served built HTML must have exactly one real entry module');
                }
                return builtEntries[0]?.getAttribute('src') ?? null;
            };
            const realEntrySource = discoverEntry(html);
            if (realEntrySource === null) {
                return { entrySource: null, decoyEntrySources: {} };
            }
            const sourceAttribute = [`src="${realEntrySource}"`, `src='${realEntrySource}'`].find((attribute) =>
                html.includes(attribute)
            );
            if (sourceAttribute === undefined) {
                throw new Error('Served HTML has no addressable entry module');
            }
            const sourceOffset = html.indexOf(sourceAttribute);
            const scriptStart = html.lastIndexOf('<script', sourceOffset);
            const scriptEnd = html.indexOf('</script>', sourceOffset);
            if (scriptStart < 0 || scriptEnd < 0) {
                throw new Error('Served HTML has an unterminated entry module');
            }
            const insertionPoint = scriptEnd + '</script>'.length;
            const withDecoy = (decoy: string, position: 'leading' | 'trailing'): string => {
                const offset = position === 'leading' ? scriptStart : insertionPoint;
                return `${html.slice(0, offset)}${decoy}${html.slice(offset)}`;
            };
            const decoys = {
                inertNoscript: '<noscript><script type="module" src="/startup-decoy.js"></script></noscript>',
                svg: '<svg><script type="module" src="/startup-decoy.js"></script></svg>',
                active: '<script type="module" src="/startup-decoy.js"></script>',
                async: '<script async type="module" src="/startup-decoy.js"></script>',
            };
            return {
                entrySource: realEntrySource,
                decoyEntrySources: Object.fromEntries(
                    Object.entries(decoys).flatMap(([name, decoy]) => [
                        [`leading-${name}`, discoverEntry(withDecoy(decoy, 'leading'))],
                        [`trailing-${name}`, discoverEntry(withDecoy(decoy, 'trailing'))],
                    ])
                ),
            };
        },
        await response.text()
    );
    if (entrySource === null) {
        throw new Error('Served HTML has no entry module');
    }
    expect(entrySource).toMatch(/^(?:\/src\/app\/main\.tsx|\.\/assets\/index-[A-Za-z0-9_-]+\.js)$/u);
    for (const [decoy, decoyEntrySource] of Object.entries(decoyEntrySources)) {
        expect.soft(decoyEntrySource, `${decoy} must not replace the real entry`).toBe(entrySource);
    }
    const entryUrl = new URL(entrySource, response.url()).href;
    const prepaintGate = deferred<string>();
    const entryGate = deferred<string>();
    let prepaintRequests = 0;
    let entryRequests = 0;
    await page.addInitScript((key) => {
        window.localStorage.setItem(key, JSON.stringify({ json: { theme: 'light' } }));
        const samples: Array<{ visibility: string; backgroundColor: string; color: string }> = [];
        Object.assign(window, { __sourdawStartupFrames: samples });
        const record = (): void => {
            const startup = document.getElementById('entry-startup');
            if (startup !== null) {
                const style = window.getComputedStyle(startup);
                samples.push({
                    visibility: style.visibility,
                    backgroundColor: style.backgroundColor,
                    color: style.color,
                });
            }
            window.requestAnimationFrame(record);
        };
        window.requestAnimationFrame(record);
    }, PREFERENCES_STORAGE_KEY);
    await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/themePrepaint.js') {
            prepaintRequests += 1;
            await prepaintGate.promise;
        }
        if (route.request().url() === entryUrl) {
            entryRequests += 1;
            await entryGate.promise;
        }
        await route.continue();
    });
    const readVisibleStartupFrames = (): Promise<Array<{ backgroundColor: string; color: string }>> =>
        page.evaluate(() => {
            const samples =
                (
                    window as unknown as {
                        __sourdawStartupFrames?: Array<{
                            visibility: string;
                            backgroundColor: string;
                            color: string;
                        }>;
                    }
                ).__sourdawStartupFrames ?? [];
            return samples
                .filter((sample) => sample.visibility === 'visible')
                .map((sample) => ({ backgroundColor: sample.backgroundColor, color: sample.color }));
        });

    try {
        await page.goto('/', { waitUntil: 'commit' });
        await expect.poll(() => prepaintRequests).toBe(1);
        await expect.poll(() => entryRequests).toBe(1);
        await expect(page.locator('#entry-startup')).toHaveCount(1);
        await expect(page.locator('#entry-startup')).toBeHidden();
        await expect(page.getByLabel(LAUNCH_SCREEN_NAME)).toHaveCount(0);

        prepaintGate.resolve('release prepaint');
        await expect(page.locator('html')).toHaveClass('light');
        await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
        await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#ded8cf');
        await expect(page.locator('#entry-startup')).toHaveCSS('background-color', 'rgb(222, 216, 207)');
        await expect(page.locator('#entry-startup')).toHaveCSS('color', 'rgb(41, 37, 33)');
        await expect(page.getByLabel(LAUNCH_SCREEN_NAME)).toHaveCount(0);
        expect(entryRequests).toBe(1);
        await expect.poll(async () => (await readVisibleStartupFrames()).length).toBeGreaterThan(0);
        const visibleStartupFrames = await readVisibleStartupFrames();
        for (const frame of visibleStartupFrames) {
            expect(frame).toEqual({ backgroundColor: 'rgb(222, 216, 207)', color: 'rgb(41, 37, 33)' });
        }

        entryGate.resolve('release entry');
        await wait_for_launch_first_paint(page);
    } finally {
        prepaintGate.resolve('release prepaint');
        entryGate.resolve('release entry');
        await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
});

test('keeps aborted prepaint hidden until runtime synchronization restores saved Light', async ({ page }) => {
    await enable_direct_e2e_viewport(page);
    const response = await page.request.get('/');
    expect(response.ok()).toBe(true);
    const entrySource = await page.evaluate(
        (html) => {
            const parsed = new DOMParser().parseFromString(html, 'text/html');
            return [...parsed.querySelectorAll('script[type="module" i][src]')].at(-1)?.getAttribute('src') ?? null;
        },
        await response.text()
    );
    if (entrySource === null) {
        throw new Error('Served HTML has no entry module');
    }
    const entryUrl = new URL(entrySource, response.url()).href;
    const entryGate = deferred<string>();
    let prepaintRequests = 0;
    let entryRequests = 0;
    await page.addInitScript((key) => {
        window.localStorage.setItem(key, JSON.stringify({ json: { theme: 'light' } }));
    }, PREFERENCES_STORAGE_KEY);
    await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/themePrepaint.js') {
            prepaintRequests += 1;
            await route.abort('aborted');
            return;
        }
        if (route.request().url() === entryUrl) {
            entryRequests += 1;
            await entryGate.promise;
        }
        await route.continue();
    });

    try {
        await page.goto('/', { waitUntil: 'commit' });
        await expect.poll(() => prepaintRequests).toBe(1);
        await expect.poll(() => entryRequests).toBe(1);
        const startup = page.locator('#entry-startup');
        await expect(startup).toHaveCount(1);
        await expect(startup).toBeHidden();

        entryGate.resolve('release entry');
        await wait_for_launch_first_paint(page);
        await expect(page.locator('html')).toHaveClass('light');
        await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
        await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#ded8cf');
    } finally {
        entryGate.resolve('release entry');
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

test('reveals desktop connection recovery instead of leaving the root hidden', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'userAgent', {
            configurable: true,
            get: () => 'Mozilla/5.0 Electron/33.0.0 Sourdaw',
        });
    });

    await page.goto('/');

    const failure = page.getByRole('alert', { name: 'Sourdaw could not start' });
    await expect(failure).toBeVisible();
    await expect(
        failure.getByText('The desktop connection did not load. Reload Sourdaw to try starting it again.')
    ).toBeVisible();
    await expect(failure.getByRole('button', { name: 'Reload Sourdaw' })).toBeVisible();
    await expect(page.locator('html')).toHaveCSS('visibility', 'visible');
});

test('reveals the saved Light theme on the unsupported-phone gate', async ({ browser, baseURL }) => {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 393, height: 852 },
        screen: { width: 393, height: 852 },
        isMobile: true,
        hasTouch: true,
    });
    const phone = await context.newPage();
    try {
        await enable_direct_e2e_viewport(phone);
        await phone.addInitScript((key) => {
            window.localStorage.setItem(key, JSON.stringify({ json: { theme: 'light', uiScale: 1 } }));
        }, PREFERENCES_STORAGE_KEY);

        await phone.goto('/');

        await expect(phone.getByText('Desktop DAW')).toBeVisible({ timeout: LAUNCH_SCREEN_FIRST_PAINT_TIMEOUT_MS });
        await expect(phone.locator('html')).toHaveClass('light');
        await expect(phone.locator('html')).toHaveCSS('visibility', 'visible');
        await expect(phone.getByTestId('transport-play')).toHaveCount(0);
    } finally {
        await context.close();
    }
});

test.describe('with JavaScript disabled', () => {
    test.use({ javaScriptEnabled: false });

    test('keeps the static startup and reload guidance visible', async ({ page }) => {
        await page.goto('/');

        await expect(page.getByRole('status', { name: 'Starting Sourdaw' })).toBeVisible();
        await expect(
            page.getByText("If this screen remains, use your browser's Reload to try starting Sourdaw again.")
        ).toBeVisible();
        await expect(page.locator('html')).toHaveCSS('visibility', 'visible');
        await expect(page.locator('#entry-startup')).toHaveCSS('background-color', 'rgb(2, 1, 0)');
        await expect(page.locator('#entry-startup')).toHaveCSS('color', 'rgb(238, 238, 238)');
    });
});
