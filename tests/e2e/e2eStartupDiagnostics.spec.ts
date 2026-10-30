import { rm } from 'node:fs/promises';

import { test, expect } from '@playwright/test';

import { createFixture, deferred, event } from '../../scripts/__tests__/fixtures/e2eStartupDiagnostics.ts';

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
