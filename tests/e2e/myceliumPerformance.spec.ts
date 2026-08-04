import { expect, test } from '@playwright/test';

import {
    attachEvidence,
    captureFailureEvidence,
    launchMycelium,
    openMeasuredPage,
    readPageMemory,
    rebuildMycelium,
    readRuntimeSnapshot,
    rejectOnPageErrorDuring,
    type RuntimeSnapshot,
    startMyceliumPlaybackForReadiness,
    startLongTaskWindow,
    stopMyceliumPlaybackAfterReadiness,
    stopLongTaskWindow,
    waitForPlayableDevices,
    warmPlaybackBeforeReplacement,
} from './myceliumPerformanceEvidence';
import {
    captureMyceliumPlayback,
    captureSimplePlaybackControl,
    refreshPagePlaybackStats,
    type MyceliumPlaybackProgress,
    type SimplePlaybackControl,
} from './myceliumPlaybackEvidence';

type MeasuredPage = Awaited<ReturnType<typeof openMeasuredPage>>;

async function runMeasuredScenario<T>({
    captureFailure,
    label,
    measured,
    operation,
    testInfo,
    timeoutMs,
}: {
    captureFailure?: (error: unknown) => Promise<void>;
    label: string;
    measured: MeasuredPage;
    operation: () => Promise<T>;
    testInfo: Parameters<typeof captureFailureEvidence>[0]['testInfo'];
    timeoutMs: number;
}): Promise<T> {
    const capture =
        captureFailure ??
        ((error: unknown) =>
            captureFailureEvidence({
                testInfo,
                page: measured.page,
                environment: measured.environment,
                error,
            }));
    const failureEvidence = { captured: false };
    try {
        return await rejectOnPageErrorDuring({
            abort: measured.abort,
            captureBeforeAbort: async (error) => {
                await capture(error);
                failureEvidence.captured = true;
            },
            label,
            operation,
            page: measured.page,
            pageError: measured.pageError,
            timeoutMs,
        });
    } catch (error) {
        if (!failureEvidence.captured) {
            try {
                await capture(error);
            } catch {
                // Preserve the scenario failure when fallback evidence capture is unavailable.
            }
        }
        throw error;
    }
}

async function stopLongTaskWindowBestEffort(measured: MeasuredPage) {
    try {
        return await stopLongTaskWindow(measured.page);
    } catch {
        return null;
    }
}

test('captures a cold Mycelium project-load readiness sample in stable Chrome', async ({ browserName }, testInfo) => {
    test.setTimeout(600_000);
    expect(browserName).toBe('chromium');
    const measured = await openMeasuredPage(testInfo);
    try {
        await runMeasuredScenario({
            label: 'Cold Mycelium readiness evidence',
            measured,
            operation: async () => {
                const projectLoadStartedAtMs = performance.now();
                await launchMycelium(measured.page);
                await startMyceliumPlaybackForReadiness(measured.page);
                const ready = await waitForPlayableDevices({
                    page: measured.page,
                    timeoutMs: measured.environment.smoke ? 60_000 : 120_000,
                });
                const readyAtMs = performance.now();

                await attachEvidence(testInfo, 'mycelium-cold-project-readiness', {
                    schemaVersion: 1,
                    scenario: 'cold-project-readiness',
                    environment: measured.environment,
                    projectReadinessDurationMs: readyAtMs - projectLoadStartedAtMs,
                    readinessOutcome: ready.outcome,
                    expectedAudioDeviceCount: ready.expectedAudioDeviceCount,
                    runtime: ready.snapshot,
                });

                expect(ready.expectedAudioDeviceCount).toBeGreaterThan(0);
                expect(ready.outcome).toBe('ready');
            },
            testInfo,
            timeoutMs: measured.environment.smoke ? 180_000 : 300_000,
        });
    } finally {
        await measured.close();
    }
});

test('captures isolated Mycelium memory checkpoints in stable Chrome', async ({ browserName }, testInfo) => {
    test.setTimeout(700_000);
    expect(browserName).toBe('chromium');
    const measured = await openMeasuredPage(testInfo);
    try {
        await runMeasuredScenario({
            label: 'Mycelium memory evidence',
            measured,
            operation: async () => {
                expect(measured.environment.capabilities.hasMeasureMemory).toBe(true);
                const beforeProjectLoad = await readPageMemory({
                    label: 'Before-project-load memory checkpoint',
                    page: measured.page,
                });
                await launchMycelium(measured.page);
                await startMyceliumPlaybackForReadiness(measured.page);
                const ready = await waitForPlayableDevices({
                    page: measured.page,
                    timeoutMs: measured.environment.smoke ? 60_000 : 120_000,
                });
                expect(ready.expectedAudioDeviceCount).toBeGreaterThan(0);
                expect(ready.outcome).toBe('ready');
                const playableReady = await readPageMemory({
                    label: 'Playable-ready memory checkpoint',
                    page: measured.page,
                });
                await attachEvidence(testInfo, 'mycelium-memory-checkpoints', {
                    schemaVersion: 1,
                    scenario: 'isolated-memory-checkpoints',
                    environment: measured.environment,
                    expectedAudioDeviceCount: ready.expectedAudioDeviceCount,
                    memory: {
                        beforeProjectLoad,
                        playableReady,
                        deltaBytes: playableReady.bytes - beforeProjectLoad.bytes,
                    },
                    readinessOutcome: ready.outcome,
                    runtime: ready.snapshot,
                });
                expect(beforeProjectLoad.bytes).toBeGreaterThan(0);
                expect(playableReady.bytes).toBeGreaterThan(0);
            },
            testInfo,
            timeoutMs: measured.environment.smoke ? 240_000 : 420_000,
        });
    } finally {
        await measured.close();
    }
});

test('captures a windowed warm Mycelium project replacement in stable Chrome', async ({ browserName }, testInfo) => {
    test.setTimeout(900_000);
    expect(browserName).toBe('chromium');
    const measured = await openMeasuredPage(testInfo);
    const longTaskWindow = { active: false };
    const observedWarmupSnapshots: RuntimeSnapshot[] = [];
    let completedWarmupLongTasks: Awaited<ReturnType<typeof stopLongTaskWindow>> | null = null;
    const captureWarmFailure = async (error: unknown): Promise<void> => {
        let failureLongTasks = null;
        if (longTaskWindow.active) {
            failureLongTasks = await stopLongTaskWindowBestEffort(measured);
            if (failureLongTasks) {
                longTaskWindow.active = false;
            }
        }
        await captureFailureEvidence({
            testInfo,
            page: measured.page,
            environment: measured.environment,
            error,
            partial: {
                activeWindowLongTasks: failureLongTasks,
                warmupLongTasks: completedWarmupLongTasks,
                warmupSnapshots: observedWarmupSnapshots,
            },
        });
    };
    try {
        await runMeasuredScenario({
            captureFailure: captureWarmFailure,
            label: 'Warm Mycelium transition evidence',
            measured,
            operation: async () => {
                expect(measured.environment.capabilities.hasLongTasks).toBe(true);
                await launchMycelium(measured.page);
                await startMyceliumPlaybackForReadiness(measured.page);
                const coldReady = await waitForPlayableDevices({
                    page: measured.page,
                    timeoutMs: measured.environment.smoke ? 60_000 : 120_000,
                });
                expect(coldReady.outcome).toBe('ready');
                await stopMyceliumPlaybackAfterReadiness(measured.page);
                const staleWarmPlaybackBoundary = await readRuntimeSnapshot(measured.page);
                await refreshPagePlaybackStats(measured.page, staleWarmPlaybackBoundary, false);
                await startMyceliumPlaybackForReadiness(measured.page);
                await startLongTaskWindow(measured.page);
                longTaskWindow.active = true;
                const warmupSnapshots = await warmPlaybackBeforeReplacement({
                    expectedAudioDeviceCount: coldReady.expectedAudioDeviceCount,
                    onSnapshot: (snapshot) => observedWarmupSnapshots.push(snapshot),
                    readSnapshot: () => readRuntimeSnapshot(measured.page),
                    wait: (durationMs) => measured.page.waitForTimeout(durationMs),
                });
                completedWarmupLongTasks = await stopLongTaskWindow(measured.page);
                longTaskWindow.active = false;
                await startLongTaskWindow(measured.page);
                longTaskWindow.active = true;
                const rebuildStartedAtMs = performance.now();
                await rebuildMycelium(measured.page);
                await startMyceliumPlaybackForReadiness(measured.page);
                const warmReady = await waitForPlayableDevices({
                    page: measured.page,
                    successorOfGeneration: coldReady.readinessGeneration,
                    timeoutMs: measured.environment.smoke ? 60_000 : 120_000,
                });
                const warmProjectReadinessDurationMs = performance.now() - rebuildStartedAtMs;
                const longTasks = await stopLongTaskWindow(measured.page);
                longTaskWindow.active = false;

                await attachEvidence(testInfo, 'mycelium-warm-project-readiness', {
                    schemaVersion: 1,
                    scenario: 'warm-project-readiness',
                    environment: measured.environment,
                    expectedAudioDeviceCount: warmReady.expectedAudioDeviceCount,
                    longTasks,
                    readinessGeneration: {
                        cold: coldReady.readinessGeneration,
                        expectedWarm: coldReady.readinessGeneration + 1,
                        warm: warmReady.readinessGeneration,
                    },
                    warmupLongTasks: completedWarmupLongTasks,
                    warmupSnapshots,
                    warmProjectReadinessDurationMs,
                    readinessOutcome: warmReady.outcome,
                    runtime: { cold: coldReady.snapshot, warm: warmReady.snapshot },
                });

                expect(warmReady.expectedAudioDeviceCount).toBeGreaterThan(0);
                expect(warmReady.outcome).toBe('ready');
            },
            testInfo,
            timeoutMs: measured.environment.smoke ? 300_000 : 480_000,
        });
    } finally {
        if (longTaskWindow.active) {
            await stopLongTaskWindowBestEffort(measured);
        }
        await measured.close();
    }
});

test('captures bounded unchanged-loop Mycelium playback evidence in stable Chrome', async ({
    browserName,
}, testInfo) => {
    test.setTimeout(900_000);
    expect(browserName).toBe('chromium');
    const measured = await openMeasuredPage(testInfo);
    const playbackProgress: MyceliumPlaybackProgress = {
        phase: 'starting',
        cdpSamples: [],
        longTasks: null,
        playheadSamples: [],
        startup: null,
    };
    let control: SimplePlaybackControl | null = null;
    const playbackLongTaskWindow = { active: false };
    const capturePlaybackFailure = async (error: unknown): Promise<void> => {
        if (playbackLongTaskWindow.active) {
            const longTasks = await stopLongTaskWindowBestEffort(measured);
            if (longTasks) {
                playbackProgress.longTasks = longTasks;
                playbackLongTaskWindow.active = false;
            }
        }
        await captureFailureEvidence({
            testInfo,
            page: measured.page,
            environment: measured.environment,
            error,
            partial: { control, playback: playbackProgress },
        });
    };
    try {
        await runMeasuredScenario({
            captureFailure: capturePlaybackFailure,
            label: 'Mycelium playback evidence scenario',
            measured,
            operation: async () => {
                control = await captureSimplePlaybackControl(measured.page);
                if (control.outcome !== 'clean') {
                    throw new Error(
                        `NOT MEASURED — simple AudioContext control recorded ${String(control.playback.underrunEvents)} ` +
                            `underruns and a ${control.realtimeRatio.toFixed(4)} realtime ratio`
                    );
                }
                await launchMycelium(measured.page);
                await startMyceliumPlaybackForReadiness(measured.page);
                const ready = await waitForPlayableDevices({
                    page: measured.page,
                    timeoutMs: measured.environment.smoke ? 60_000 : 120_000,
                });
                expect(ready.expectedAudioDeviceCount).toBeGreaterThan(0);
                expect(ready.outcome).toBe('ready');
                await stopMyceliumPlaybackAfterReadiness(measured.page);
                await startLongTaskWindow(measured.page);
                playbackLongTaskWindow.active = true;
                const playback = await captureMyceliumPlayback({
                    page: measured.page,
                    progress: playbackProgress,
                    smoke: measured.environment.smoke,
                });
                playbackProgress.longTasks = await stopLongTaskWindow(measured.page);
                playbackLongTaskWindow.active = false;

                await attachEvidence(testInfo, 'mycelium-playback-runtime', {
                    schemaVersion: 2,
                    scenario: 'unchanged-loop-playback-runtime',
                    environment: measured.environment,
                    expectedAudioDeviceCount: ready.expectedAudioDeviceCount,
                    control,
                    playback,
                    progress: playbackProgress,
                });

                expect(control.playback.totalDuration).toBeGreaterThan(0);
                expect(control.playback.underrunDuration).toBe(0);
                expect(control.playback.underrunEvents).toBe(0);
                expect(control.realtimeRatio).toBeGreaterThanOrEqual(0.9);
                expect(control.realtimeRatio).toBeLessThanOrEqual(1.1);
                expect(playback.expectedDurationMs).toBeGreaterThan(0);
                expect(playback.playheadSamples.length).toBeGreaterThan(1);
                expect(playback.realtimeRatio).toBeGreaterThanOrEqual(0.9);
                expect(playback.realtimeRatio).toBeLessThanOrEqual(1.1);
                if (!measured.environment.smoke) {
                    expect(playback.tempoMapDurationRatio).toBeGreaterThanOrEqual(0.98);
                    expect(playback.tempoMapDurationRatio).toBeLessThanOrEqual(1.05);
                }
                expect(playback.tailHorizonSeconds).toBeGreaterThanOrEqual(0);
                expect(playback.tailDrainElapsedMs).toBeGreaterThanOrEqual(playback.tailHorizonSeconds * 1_000);
                expect(playback.runtime.summary.playback.totalDuration).toBeGreaterThan(0);
                expect(playback.runtime.summary.playback.underrunDuration).toBe(0);
                expect(playback.runtime.summary.playback.underrunEvents).toBe(0);
                expect(playback.runtime.startupPlayback.totalDuration).toBeGreaterThan(0);
                expect(playback.runtime.startupPlayback.underrunDuration).toBe(0);
                expect(playback.runtime.startupPlayback.underrunEvents).toBe(0);
                expect(playback.runtime.bodyPlayback.totalDuration).toBeGreaterThan(0);
                expect(playback.runtime.bodyPlayback.underrunDuration).toBe(0);
                expect(playback.runtime.bodyPlayback.underrunEvents).toBe(0);
                expect(playback.runtime.stopBoundaryPlayback.totalDuration).toBeGreaterThan(0);
                expect(playback.runtime.stopBoundaryPlayback.underrunDuration).toBe(0);
                expect(playback.runtime.stopBoundaryPlayback.underrunEvents).toBe(0);
                expect(playback.runtime.postStopPlayback.totalDuration).toBeGreaterThan(0);
                expect(playback.runtime.postStopPlayback.underrunDuration).toBe(0);
                expect(playback.runtime.postStopPlayback.underrunEvents).toBe(0);
                expect(playback.runtime.tailSummary.playback.underrunDuration).toBe(0);
                expect(playback.runtime.tailSummary.playback.underrunEvents).toBe(0);
                expect(playback.runtime.tailSummary.detectedDropouts.detectedUnderrunBlocks).toBe(0);
                expect(playback.runtime.tailSummary.detectedDropouts.silentFrames).toBe(0);
                expect(playback.runtime.fullPlaybackHealth.playback.underrunDuration).toBe(0);
                expect(playback.runtime.fullPlaybackHealth.playback.underrunEvents).toBe(0);
                expect(playback.runtime.fullPlaybackHealth.detectedDropouts.detectedUnderrunBlocks).toBe(0);
                expect(playback.runtime.fullPlaybackHealth.detectedDropouts.silentFrames).toBe(0);
                expect(playback.runtime.summary.detectedDropouts.detectedUnderrunBlocks).toBe(0);
                expect(playback.runtime.summary.detectedDropouts.silentFrames).toBe(0);
                expect(playback.runtime.summary.scheduler.sequenceGaps).toBe(0);
                expect(playback.runtime.summary.scheduler.outOfOrderMessages).toBe(0);
                expect(playback.runtime.summary.scheduler.ticksSkippedInFlight).toBe(0);
                expect(playback.runtime.summary.scheduler.deliveryDeadlineMisses).toBe(0);
                expect(playback.outcome).toBe(measured.environment.smoke ? 'safety-limit' : 'loop-complete');
            },
            testInfo,
            timeoutMs: measured.environment.smoke ? 240_000 : 720_000,
        });
    } finally {
        if (playbackLongTaskWindow.active) {
            await stopLongTaskWindowBestEffort(measured);
        }
        await measured.close();
    }
});
