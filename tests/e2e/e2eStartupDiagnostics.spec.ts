import { rm } from 'node:fs/promises';

import { createFixture, deferred, event } from '../../scripts/__tests__/fixtures/e2eStartupDiagnostics.ts';

import { test, expect } from './e2eTest';
import { enable_direct_e2e_viewport, LAUNCH_SCREEN_NAME, PREFERENCES_STORAGE_KEY } from './e2eUtils';

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

    try {
        await page.goto('/', { waitUntil: 'commit' });
        await expect.poll(() => prepaintRequests).toBe(1);
        await expect(page.locator('#entry-startup')).toHaveCount(0);
        await expect(page.getByLabel(LAUNCH_SCREEN_NAME)).toHaveCount(0);

        prepaintGate.resolve('release prepaint');
        await expect.poll(() => entryRequests).toBe(1);
        await expect(page.locator('html')).toHaveClass('light');
        await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
        await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#ded8cf');
        await expect(page.locator('#entry-startup')).toHaveCSS('background-color', 'rgb(222, 216, 207)');
        await expect(page.getByLabel(LAUNCH_SCREEN_NAME)).toHaveCount(0);
        expect(entryRequests).toBe(1);

        entryGate.resolve('release entry');
        await expect(page.getByLabel(LAUNCH_SCREEN_NAME)).toBeVisible({ timeout: 30_000 });
    } finally {
        prepaintGate.resolve('release prepaint');
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
