import { expect, test, type CDPSession, type Page } from '@playwright/test';

import {
    attachEvidence,
    captureFailureEvidence,
    launchMycelium,
    openMeasuredPage,
    readPageMemory,
    readRuntimeSnapshot,
    rebuildMycelium,
    startLongTaskWindow,
    stopLongTaskWindow,
    waitForPlayableDevices,
} from './myceliumPerformanceEvidence';

const CUMULATIVE_CDP_METRICS = [
    'LayoutCount',
    'LayoutDuration',
    'RecalcStyleCount',
    'RecalcStyleDuration',
    'ScriptDuration',
    'TaskDuration',
] as const;
const GAUGE_CDP_METRICS = [
    'Documents',
    'Frames',
    'JSEventListeners',
    'JSHeapTotalSize',
    'JSHeapUsedSize',
    'Nodes',
] as const;
const REQUIRED_CDP_METRICS = ['Timestamp', ...CUMULATIVE_CDP_METRICS, ...GAUGE_CDP_METRICS] as const;

type CdpMetricSample = {
    elapsedMs: number;
    values: Record<string, number>;
};

function runtimeTransport(snapshot: Awaited<ReturnType<typeof readRuntimeSnapshot>>): Record<string, unknown> {
    if (typeof snapshot.transport !== 'object' || snapshot.transport === null) {
        throw new TypeError('Runtime snapshot has no transport state');
    }
    return snapshot.transport as Record<string, unknown>;
}

function finiteTransportNumber(transport: Record<string, unknown>, name: string): number {
    const value = transport[name];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`Transport state has no finite ${name}`);
    }
    return value;
}

function throwIfPageErrored(state: { error: unknown }): void {
    if (state.error instanceof Error) {
        throw state.error;
    }
}

async function readLivePlayhead(page: Page): Promise<number> {
    return page.evaluate(async () => {
        type TransportStoresModule = {
            playheadPositionRef: { current: number };
        };
        const module: unknown = await import('/src/modules/Transport/stores/index.ts');
        const isTransportStoresModule = (value: unknown): value is TransportStoresModule =>
            typeof value === 'object' &&
            value !== null &&
            'playheadPositionRef' in value &&
            typeof value.playheadPositionRef === 'object' &&
            value.playheadPositionRef !== null &&
            'current' in value.playheadPositionRef &&
            typeof value.playheadPositionRef.current === 'number' &&
            Number.isFinite(value.playheadPositionRef.current);
        if (!isTransportStoresModule(module)) {
            throw new TypeError('Mycelium playback E2E could not resolve the live playhead contract');
        }
        return module.playheadPositionRef.current;
    });
}

async function waitForLivePlayheadAdvance(input: { page: Page; fromBeat: number }): Promise<number> {
    let currentBeat = await readLivePlayhead(input.page);
    while (currentBeat <= input.fromBeat) {
        await input.page.waitForTimeout(100);
        currentBeat = await readLivePlayhead(input.page);
    }
    return currentBeat;
}

async function projectPlaybackDurationMs(input: {
    page: Page;
    defaultTempo: number;
    fromBeat: number;
    toBeat: number;
}): Promise<number> {
    return input.page.evaluate(
        async ({ defaultTempo, fromBeat, toBeat }) => {
            type TempoChange = {
                beat: number;
                tempo: number;
                curve: 'instant' | 'linear';
            };
            type ProjectPpqEndpoints = (parameters: {
                startPpq: number;
                endPpq: number;
                defaultTempo: number;
                sampleRate: number;
                changes: readonly TempoChange[];
            }) => unknown;
            type TransportUseCasesModule = {
                projectPpqEndpoints: ProjectPpqEndpoints;
            };
            type TransportStoresModule = {
                tempoMapStore: {
                    value: { changes: TempoChange[] };
                };
            };
            const isRecord = (value: unknown): value is Record<string, unknown> =>
                typeof value === 'object' && value !== null;
            const isTempoChange = (value: unknown): value is TempoChange =>
                isRecord(value) &&
                typeof value.beat === 'number' &&
                Number.isFinite(value.beat) &&
                typeof value.tempo === 'number' &&
                Number.isFinite(value.tempo) &&
                value.tempo > 0 &&
                (value.curve === 'instant' || value.curve === 'linear');
            const isUseCasesModule = (value: unknown): value is TransportUseCasesModule =>
                isRecord(value) && typeof value.projectPpqEndpoints === 'function';
            const isStoresModule = (value: unknown): value is TransportStoresModule => {
                if (!isRecord(value) || !isRecord(value.tempoMapStore)) {
                    return false;
                }
                const tempoMap = value.tempoMapStore.value;
                return isRecord(tempoMap) && Array.isArray(tempoMap.changes) && tempoMap.changes.every(isTempoChange);
            };
            const useCasesModule: unknown = await import('/src/modules/Transport/useCases/index.ts');
            const storesModule: unknown = await import('/src/modules/Transport/stores/index.ts');
            if (!isUseCasesModule(useCasesModule) || !isStoresModule(storesModule)) {
                throw new TypeError('Mycelium playback E2E could not resolve tempo projection contracts');
            }
            const projection = useCasesModule.projectPpqEndpoints({
                startPpq: fromBeat,
                endPpq: toBeat,
                defaultTempo,
                sampleRate: 48_000,
                changes: storesModule.tempoMapStore.value.changes,
            });
            if (
                !isRecord(projection) ||
                typeof projection.durationSeconds !== 'number' ||
                !Number.isFinite(projection.durationSeconds) ||
                projection.durationSeconds <= 0
            ) {
                throw new TypeError('Mycelium playback E2E received an invalid tempo projection');
            }
            return projection.durationSeconds * 1000;
        },
        { defaultTempo: input.defaultTempo, fromBeat: input.fromBeat, toBeat: input.toBeat }
    );
}

async function readCdpMetrics(session: CDPSession, startedAtMs: number): Promise<CdpMetricSample> {
    const response = await session.send('Performance.getMetrics');
    const values: Record<string, number> = {};
    for (const metric of response.metrics) {
        values[metric.name] = metric.value;
    }
    for (const name of REQUIRED_CDP_METRICS) {
        if (!(name in values) || !Number.isFinite(values[name])) {
            throw new Error(`CDP Performance.getMetrics omitted a finite ${name}`);
        }
    }
    return { elapsedMs: performance.now() - startedAtMs, values };
}

function summarizeCdpMetrics(samples: CdpMetricSample[]): {
    cumulativeDeltas: Record<string, number>;
    gaugeHighWater: Record<string, number>;
} {
    if (samples.length < 2) {
        throw new Error('Playback metrics require a baseline and final sample');
    }
    const baseline = samples[0].values;
    const final = samples.at(-1)!.values;
    const cumulativeDeltas: Record<string, number> = {};
    for (const name of CUMULATIVE_CDP_METRICS) {
        const delta = final[name] - baseline[name];
        if (delta < 0) {
            throw new Error(`CDP cumulative metric ${name} decreased from ${baseline[name]} to ${final[name]}`);
        }
        cumulativeDeltas[name] = delta;
    }
    const gaugeHighWater: Record<string, number> = {};
    for (const name of GAUGE_CDP_METRICS) {
        gaugeHighWater[name] = Math.max(...samples.map((sample) => sample.values[name]));
    }
    return { cumulativeDeltas, gaugeHighWater };
}

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

test('captures bounded Mycelium playback and CDP runtime evidence in stable Chrome', async ({
    browserName,
}, testInfo) => {
    test.setTimeout(900_000);
    expect(browserName).toBe('chromium');
    const measured = await openMeasuredPage(testInfo);
    const samples: CdpMetricSample[] = [];
    let cdp: CDPSession | null = null;
    let playbackStarted = false;
    const pageErrorState: { error: Error | null } = { error: null };
    const onPageError = (error: Error): void => {
        pageErrorState.error = error;
    };
    try {
        await launchMycelium(measured.page);
        const ready = await waitForPlayableDevices({
            page: measured.page,
            timeoutMs: measured.environment.smoke ? 30_000 : 120_000,
        });
        expect(ready.outcome).toBe('ready');

        measured.page.on('pageerror', onPageError);
        await settleWithin(
            measured.page.evaluate(async () => {
                type TransportUseCasesModule = {
                    disableLooping: () => void;
                };
                const module: unknown = await import('/src/modules/Transport/useCases/index.ts');
                const isTransportUseCasesModule = (value: unknown): value is TransportUseCasesModule =>
                    typeof value === 'object' &&
                    value !== null &&
                    'disableLooping' in value &&
                    typeof value.disableLooping === 'function';
                if (!isTransportUseCasesModule(module)) {
                    throw new TypeError('Mycelium playback E2E could not resolve disableLooping');
                }
                module.disableLooping();
            }),
            5_000,
            'Disable looping before playback'
        );
        const initial = await settleWithin(
            readRuntimeSnapshot(measured.page),
            5_000,
            'Initial playback runtime snapshot'
        );
        const initialTransport = runtimeTransport(initial);
        const tempo = finiteTransportNumber(initialTransport, 'tempo');
        const loopEnd = finiteTransportNumber(initialTransport, 'loopEnd');

        cdp = await settleWithin(
            measured.page.context().newCDPSession(measured.page),
            5_000,
            'Create playback CDP session'
        );
        await settleWithin(cdp.send('Performance.enable'), 5_000, 'Enable CDP performance metrics');
        const cdpMeasurementStartedAtMs = performance.now();
        samples.push(
            await settleWithin(readCdpMetrics(cdp, cdpMeasurementStartedAtMs), 5_000, 'Baseline CDP playback sample')
        );
        throwIfPageErrored(pageErrorState);
        const prePlayPosition = await settleWithin(readLivePlayhead(measured.page), 5_000, 'Pre-play live position');

        await measured.page.getByRole('button', { name: 'Play', exact: true }).click({ timeout: 12_000 });
        playbackStarted = true;
        const playing = await settleWithin(
            readRuntimeSnapshot(measured.page),
            12_000,
            'Transport playing confirmation'
        );
        expect(runtimeTransport(playing).isPlaying).toBe(true);
        const confirmedPlayhead = await settleWithin(
            waitForLivePlayheadAdvance({ page: measured.page, fromBeat: prePlayPosition }),
            12_000,
            'Live playback advance confirmation'
        );
        throwIfPageErrored(pageErrorState);
        const playbackConfirmedAtMs = performance.now();
        const expectedDurationMs = await settleWithin(
            projectPlaybackDurationMs({
                page: measured.page,
                defaultTempo: tempo,
                fromBeat: confirmedPlayhead,
                toBeat: loopEnd,
            }),
            5_000,
            'Mycelium tempo-map duration projection'
        );
        if (expectedDurationMs <= 0) {
            throw new Error(`Mycelium transport duration must be positive, received ${expectedDurationMs}ms`);
        }

        const smokeLimitMs = 10_000;
        const fullSafetyLimitMs = expectedDurationMs * 1.2 + 30_000;
        const safetyLimitMs = measured.environment.smoke ? smokeLimitMs : fullSafetyLimitMs;
        let outcome: 'safety-limit' | 'transport-complete' | null = null;
        while (outcome === null) {
            throwIfPageErrored(pageErrorState);
            await measured.page.waitForTimeout(measured.environment.smoke ? 1_000 : 2_500);
            samples.push(
                await settleWithin(readCdpMetrics(cdp, cdpMeasurementStartedAtMs), 5_000, 'CDP playback sample')
            );
            throwIfPageErrored(pageErrorState);
            const playbackElapsedMs = performance.now() - playbackConfirmedAtMs;

            if (measured.environment.smoke) {
                if (playbackElapsedMs >= smokeLimitMs) {
                    outcome = 'safety-limit';
                }
                continue;
            }

            const playheadPosition = await settleWithin(
                readLivePlayhead(measured.page),
                5_000,
                'Full live playback position'
            );
            throwIfPageErrored(pageErrorState);
            if (playheadPosition >= loopEnd) {
                outcome = 'transport-complete';
                break;
            }
            if (playbackElapsedMs >= safetyLimitMs) {
                throw new Error(`Mycelium transport exceeded its ${Math.round(safetyLimitMs)}ms safety limit`);
            }
        }

        const playbackElapsedMs = performance.now() - playbackConfirmedAtMs;
        await measured.page.getByRole('button', { name: 'Stop', exact: true }).click({ timeout: 12_000 });
        const stopped = await settleWithin(readRuntimeSnapshot(measured.page), 12_000, 'Playback stop confirmation');
        expect(runtimeTransport(stopped).isPlaying).toBe(false);
        playbackStarted = false;
        samples.push(
            await settleWithin(readCdpMetrics(cdp, cdpMeasurementStartedAtMs), 5_000, 'Final CDP playback sample')
        );
        throwIfPageErrored(pageErrorState);
        const measurementElapsedMs = performance.now() - cdpMeasurementStartedAtMs;

        throwIfPageErrored(pageErrorState);
        await attachEvidence(testInfo, 'mycelium-playback-runtime', {
            schemaVersion: 1,
            scenario: 'playback-runtime',
            environment: measured.environment,
            expectedDurationMs,
            measurementElapsedMs,
            outcome,
            playbackElapsedMs,
            sampleCount: samples.length,
            metrics: summarizeCdpMetrics(samples),
            samples,
        });

        throwIfPageErrored(pageErrorState);
        if (measured.environment.smoke) {
            expect(outcome).toBe('safety-limit');
        } else {
            expect(outcome).toBe('transport-complete');
            expect(playbackElapsedMs).toBeGreaterThanOrEqual(expectedDurationMs - 5_000);
        }
    } catch (error) {
        await attachEvidence(testInfo, 'mycelium-playback-partial-cdp', { samples }).catch(() => undefined);
        await captureFailureEvidence({
            testInfo,
            page: measured.page,
            environment: measured.environment,
            error,
        }).catch(() => undefined);
        throw error;
    } finally {
        measured.page.off('pageerror', onPageError);
        if (playbackStarted) {
            await measured.page
                .getByRole('button', { name: 'Stop', exact: true })
                .click({ timeout: 5_000 })
                .catch(() => undefined);
        }
        if (cdp) {
            await settleWithin(cdp.detach(), 5_000, 'Detach playback CDP session').catch(() => undefined);
        }
        await settleWithin(measured.browser.close(), 10_000, 'Close playback browser').catch(() => undefined);
    }
});
