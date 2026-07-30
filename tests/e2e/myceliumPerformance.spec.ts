import { expect, test, type Page } from '@playwright/test';

import {
    attachEvidence,
    captureFailureEvidence,
    launchMycelium,
    openMeasuredPage,
    readPageMemory,
    rebuildMycelium,
    startLongTaskWindow,
    stopLongTaskWindow,
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

async function settleWithin<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} did not settle within ${timeoutMs}ms`)), timeoutMs);
    });
    try {
        return await Promise.race([operation, deadline]);
    } finally {
        clearTimeout(timer);
    }
}

async function rejectOnPageErrorDuring<T>(
    page: Page,
    operation: () => Promise<T>,
    timeoutMs: number,
    label: string
): Promise<T> {
    let rejectPageError: (error: Error) => void = () => undefined;
    const pageError = new Promise<never>((_resolve, reject) => {
        rejectPageError = reject;
    });
    const onPageError = (error: Error): void => rejectPageError(error);
    page.on('pageerror', onPageError);
    try {
        return await settleWithin(Promise.race([operation(), pageError]), timeoutMs, label);
    } finally {
        page.off('pageerror', onPageError);
    }
}

test('captures a cold Mycelium readiness sample in stable Chrome', async ({ browserName }, testInfo) => {
    test.setTimeout(360_000);
    expect(browserName).toBe('chromium');
    const measured = await openMeasuredPage(testInfo);
    try {
        const launchedAtMs = performance.now();
        await launchMycelium(measured.page);
        const ready = await waitForPlayableDevices({
            page: measured.page,
            timeoutMs: measured.environment.smoke ? 30_000 : 120_000,
        });
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

test('captures isolated Mycelium memory checkpoints in stable Chrome', async ({ browserName }, testInfo) => {
    test.setTimeout(480_000);
    expect(browserName).toBe('chromium');
    const measured = await openMeasuredPage(testInfo);
    try {
        const beforeLaunch = await settleWithin(
            readPageMemory(measured.page),
            60_000,
            'Before-launch memory checkpoint'
        );
        await launchMycelium(measured.page);
        const ready = await waitForPlayableDevices({
            page: measured.page,
            timeoutMs: measured.environment.smoke ? 30_000 : 120_000,
        });
        const playableReady = await settleWithin(
            readPageMemory(measured.page),
            60_000,
            'Playable-ready memory checkpoint'
        );

        await attachEvidence(testInfo, 'mycelium-memory-checkpoints', {
            schemaVersion: 1,
            scenario: 'memory-checkpoints',
            environment: measured.environment,
            expectedAudioDeviceCount: ready.expectedAudioDeviceCount,
            memory: { beforeLaunch, playableReady },
            readinessOutcome: ready.outcome,
            runtime: ready.snapshot,
        });

        expect(beforeLaunch.bytes).toBeGreaterThan(0);
        expect(playableReady.bytes).toBeGreaterThan(0);
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

test('captures a windowed warm Mycelium rebuild in stable Chrome', async ({ browserName }, testInfo) => {
    test.setTimeout(660_000);
    expect(browserName).toBe('chromium');
    const measured = await openMeasuredPage(testInfo);
    let longTaskWindowActive = false;
    try {
        await launchMycelium(measured.page);
        const coldReady = await waitForPlayableDevices({
            page: measured.page,
            timeoutMs: measured.environment.smoke ? 30_000 : 120_000,
        });
        expect(coldReady.outcome).toBe('ready');

        await startLongTaskWindow(measured.page);
        longTaskWindowActive = true;
        const rebuildStartedAtMs = performance.now();
        const { longTasks, warmReady } = await rejectOnPageErrorDuring(
            measured.page,
            async () => {
                await rebuildMycelium(measured.page);
                const ready = await waitForPlayableDevices({
                    page: measured.page,
                    baseline: coldReady.snapshot,
                    timeoutMs: measured.environment.smoke ? 30_000 : 120_000,
                });
                const observedLongTasks = await settleWithin(
                    stopLongTaskWindow(measured.page),
                    5_000,
                    'Warm long-task window cleanup'
                );
                longTaskWindowActive = false;
                return { longTasks: observedLongTasks, warmReady: ready };
            },
            measured.environment.smoke ? 70_000 : 250_000,
            'Warm Mycelium transition'
        );
        const rebuildDurationMs = performance.now() - rebuildStartedAtMs;

        await attachEvidence(testInfo, 'mycelium-warm-readiness', {
            schemaVersion: 1,
            scenario: 'warm-readiness',
            environment: measured.environment,
            expectedAudioDeviceCount: warmReady.expectedAudioDeviceCount,
            longTasks,
            readinessDurationMs: rebuildDurationMs,
            readinessOutcome: warmReady.outcome,
            runtime: { cold: coldReady.snapshot, warm: warmReady.snapshot },
        });

        expect(readinessRequested(warmReady.snapshot)).toBeGreaterThan(readinessRequested(coldReady.snapshot));
        expect(warmReady.outcome).toBe('ready');
    } catch (error) {
        if (longTaskWindowActive) {
            await settleWithin(stopLongTaskWindow(measured.page), 5_000, 'Warm long-task fallback cleanup').catch(
                () => undefined
            );
        }
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
