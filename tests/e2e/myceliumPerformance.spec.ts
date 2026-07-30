import { expect, test } from '@playwright/test';

import {
    attachEvidence,
    captureFailureEvidence,
    launchMycelium,
    openMeasuredPage,
    waitForPlayableDevices,
} from './myceliumPerformanceEvidence';

function readinessRequested(snapshot: unknown): number {
    if (typeof snapshot !== 'object' || snapshot === null) {
        throw new TypeError('Runtime snapshot must be an object');
    }
    const readiness: unknown = Reflect.get(snapshot, 'readiness');
    if (typeof readiness !== 'object' || readiness === null) {
        throw new TypeError('Readiness snapshot must be an object');
    }
    const counts: unknown = Reflect.get(readiness, 'counts');
    if (typeof counts !== 'object' || counts === null) {
        throw new TypeError('Readiness counts must be an object');
    }
    const requested: unknown = Reflect.get(counts, 'requested');
    if (typeof requested !== 'number') {
        throw new TypeError('Readiness snapshot has no requested count');
    }
    return requested;
}

test('captures a cold Mycelium readiness sample in stable Chrome', async ({ browserName }, testInfo) => {
    test.setTimeout(240_000);
    expect(browserName).toBe('chromium');
    const measured = await openMeasuredPage(testInfo);
    try {
        const launchedAtMs = performance.now();
        await launchMycelium(measured.page);
        const ready = await waitForPlayableDevices(measured.page, 1, measured.environment.smoke ? 30_000 : 120_000);
        const readyAtMs = performance.now();

        await attachEvidence(testInfo, 'mycelium-cold-readiness', {
            schemaVersion: 1,
            scenario: 'cold-readiness',
            environment: measured.environment,
            readinessDurationMs: readyAtMs - launchedAtMs,
            readinessOutcome: ready.outcome,
            expectedAudioDeviceCount: ready.expectedAudioDeviceCount,
            runtime: ready.snapshot,
        });

        expect(readinessRequested(ready.snapshot)).toBeGreaterThan(0);
        expect(ready.outcome).toBe('ready');
    } catch (error) {
        await captureFailureEvidence({
            testInfo,
            page: measured.page,
            environment: measured.environment,
            error,
        }).catch(() => undefined);
        throw error;
    } finally {
        await measured.browser.close().catch(() => undefined);
    }
});
