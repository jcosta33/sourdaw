import { expect, it, vi } from 'vitest';

import {
    closeMeasuredBrowser,
    createMeasuredBrowserCloser,
    rejectOnPageErrorDuring,
    type RuntimeSnapshot,
    warmPlaybackBeforeReplacement,
} from '../myceliumPerformanceEvidence';

function createWarmSnapshot({
    deliveryDeadlineMisses = 0,
    deviceCount = 58,
    generation = 1,
    isPlaying = true,
    lastResumeError = null,
    playheadPosition = 0,
    capturedAtMs = playheadPosition * 1_000,
    playbackTotalDuration = playheadPosition,
    schedulerMaxDeliveryLatenessMs = 0,
    underrunEvents = 0,
}: {
    capturedAtMs?: number;
    deliveryDeadlineMisses?: number;
    deviceCount?: number;
    generation?: number;
    isPlaying?: boolean;
    lastResumeError?: unknown;
    playbackTotalDuration?: number;
    playheadPosition?: number;
    schedulerMaxDeliveryLatenessMs?: number;
    underrunEvents?: number;
} = {}): RuntimeSnapshot {
    return {
        capturedAtMs,
        audio: {
            context: { state: 'running' },
            graph: { deviceInstances: deviceCount, failedDeviceInstances: 0, pendingDeviceInstances: 0 },
            playback: { totalDuration: playbackTotalDuration, underrunDuration: 0, underrunEvents },
        },
        health: {
            dropouts: { detectedUnderrunBlocks: 0, silentFrames: 0 },
            lastInitError: null,
            lastResumeError,
            workletReady: true,
        },
        livePlayheadPosition: playheadPosition,
        projectDirty: false,
        probeDurationMs: {},
        readiness: {
            counts: { cancelled: 0, failed: 0, playableReady: deviceCount, requested: deviceCount },
            generation,
        },
        scheduler: {
            deliveryDeadlineMisses,
            mainDeliveryLatenessMs: { max: schedulerMaxDeliveryLatenessMs },
            outOfOrderMessages: 0,
            sequenceGaps: 0,
            ticksSkippedInFlight: 0,
        },
        transport: { isPlaying, playheadPosition: 0 },
        visibilityState: 'visible',
    };
}

it('samples healthy advancing playback through the complete warm preparation window', async () => {
    const snapshots = [0, 12, 24, 36, 48, 60, 72].map((playheadPosition) => createWarmSnapshot({ playheadPosition }));
    const readSnapshot = vi.fn(() => {
        const snapshot = snapshots.shift();
        if (!snapshot) {
            throw new Error('Warm playback fixture exhausted');
        }
        return Promise.resolve(snapshot);
    });
    const wait = vi.fn((_durationMs: number) => Promise.resolve());
    const onSnapshot = vi.fn();

    const captured = await warmPlaybackBeforeReplacement({
        expectedAudioDeviceCount: 58,
        onSnapshot,
        readSnapshot,
        wait,
    });

    expect(captured).toHaveLength(7);
    expect(wait.mock.calls).toEqual([[5_000], [5_000], [5_000], [5_000], [5_000], [5_000]]);
    expect(readSnapshot).toHaveBeenCalledTimes(7);
    expect(onSnapshot).toHaveBeenCalledTimes(7);
});

it.each([
    ['stopped', createWarmSnapshot({ isPlaying: false, playheadPosition: 12 }), /transport stopped/],
    ['stalled', createWarmSnapshot({ capturedAtMs: 5_000, playheadPosition: 0 }), /playhead stalled/],
    [
        'faulted',
        createWarmSnapshot({ lastResumeError: { message: 'resume failed' }, playheadPosition: 12 }),
        /reported a worklet, initialization, or resume fault/,
    ],
    ['replacement graph', createWarmSnapshot({ generation: 2, playheadPosition: 12 }), /readiness generation changed/],
])('rejects an intermediate %s warm-playback sample', async (_label, invalidSnapshot, expectedError) => {
    const readSnapshot = vi
        .fn<() => Promise<RuntimeSnapshot>>()
        .mockResolvedValueOnce(createWarmSnapshot())
        .mockResolvedValueOnce(invalidSnapshot);

    await expect(
        warmPlaybackBeforeReplacement({
            expectedAudioDeviceCount: 58,
            readSnapshot,
            wait: () => Promise.resolve(),
        })
    ).rejects.toThrow(expectedError);
});

it('rejects a hidden warm-playback page', async () => {
    const hiddenSnapshot = { ...createWarmSnapshot({ playheadPosition: 12 }), visibilityState: 'hidden' as const };
    const readSnapshot = vi
        .fn<() => Promise<RuntimeSnapshot>>()
        .mockResolvedValueOnce(createWarmSnapshot())
        .mockResolvedValueOnce(hiddenSnapshot);

    await expect(
        warmPlaybackBeforeReplacement({
            expectedAudioDeviceCount: 58,
            readSnapshot,
            wait: () => Promise.resolve(),
        })
    ).rejects.toThrow(/page became hidden/);
});

it('rejects a warm-playback baseline with an empty graph', async () => {
    const baseline = createWarmSnapshot({ deviceCount: 0 });
    await expect(
        warmPlaybackBeforeReplacement({
            expectedAudioDeviceCount: 58,
            readSnapshot: () => Promise.resolve(baseline),
            wait: () => Promise.resolve(),
        })
    ).rejects.toThrow(/expected Mycelium device count/);
});

it('retains cumulative Chrome underruns from graph construction while rejecting playback-window growth', async () => {
    const snapshots = [0, 12, 24, 36, 48, 60, 72].map((playheadPosition) =>
        createWarmSnapshot({ playheadPosition, underrunEvents: 255 })
    );
    const readSnapshot = vi.fn(() => {
        const snapshot = snapshots.shift();
        if (!snapshot) {
            throw new Error('Warm Chrome playback fixture exhausted');
        }
        return Promise.resolve(snapshot);
    });

    const captured = await warmPlaybackBeforeReplacement({
        expectedAudioDeviceCount: 58,
        readSnapshot,
        wait: () => Promise.resolve(),
    });

    expect(captured).toHaveLength(7);
    expect(readSnapshot).toHaveBeenCalledTimes(7);
});

it('rejects stale Chrome playback statistics even while the live playhead advances', async () => {
    const readSnapshot = vi
        .fn<() => Promise<RuntimeSnapshot>>()
        .mockResolvedValueOnce(createWarmSnapshot({ playbackTotalDuration: 10 }))
        .mockResolvedValueOnce(createWarmSnapshot({ playbackTotalDuration: 10, playheadPosition: 12 }));

    await expect(
        warmPlaybackBeforeReplacement({
            expectedAudioDeviceCount: 58,
            readSnapshot,
            wait: () => Promise.resolve(),
        })
    ).rejects.toThrow(/Chrome playback statistics did not advance/);
});

it('rejects Chrome playback statistics that advance below real time when the sample wait overruns', async () => {
    const readSnapshot = vi
        .fn<() => Promise<RuntimeSnapshot>>()
        .mockResolvedValueOnce(createWarmSnapshot({ capturedAtMs: 1_000, playbackTotalDuration: 10 }))
        .mockResolvedValueOnce(
            createWarmSnapshot({ capturedAtMs: 11_000, playbackTotalDuration: 14.1, playheadPosition: 12 })
        );

    await expect(
        warmPlaybackBeforeReplacement({
            expectedAudioDeviceCount: 58,
            readSnapshot,
            wait: () => Promise.resolve(),
        })
    ).rejects.toThrow(/Chrome playback statistics advanced too slowly/);
});

it.each([
    ['growth', 256, /recorded Chrome underrunEvents/],
    ['reset', 0, /Chrome underrunEvents counter reset/],
])('rejects Chrome-underrun counter %s during warmup', async (_label, currentUnderruns, expectedError) => {
    const readSnapshot = vi
        .fn<() => Promise<RuntimeSnapshot>>()
        .mockResolvedValueOnce(createWarmSnapshot({ underrunEvents: 255 }))
        .mockResolvedValueOnce(createWarmSnapshot({ playheadPosition: 12, underrunEvents: currentUnderruns }));

    await expect(
        warmPlaybackBeforeReplacement({
            expectedAudioDeviceCount: 58,
            readSnapshot,
            wait: () => Promise.resolve(),
        })
    ).rejects.toThrow(expectedError);
});

it('records delivery-grain misses while the scheduler remains inside its look-ahead horizon', async () => {
    const snapshots = [0, 12, 24, 36, 48, 60, 72].map((playheadPosition) =>
        createWarmSnapshot({ deliveryDeadlineMisses: 52, playheadPosition, schedulerMaxDeliveryLatenessMs: 99 })
    );
    const readSnapshot = vi.fn(() => {
        const snapshot = snapshots.shift();
        if (!snapshot) {
            throw new Error('Warm scheduler fixture exhausted');
        }
        return Promise.resolve(snapshot);
    });

    const captured = await warmPlaybackBeforeReplacement({
        expectedAudioDeviceCount: 58,
        readSnapshot,
        wait: () => Promise.resolve(),
    });

    expect(captured).toHaveLength(7);
    expect(readSnapshot).toHaveBeenCalledTimes(7);
});

it('rejects scheduler delivery beyond the transport look-ahead horizon', async () => {
    const readSnapshot = vi
        .fn<() => Promise<RuntimeSnapshot>>()
        .mockResolvedValueOnce(createWarmSnapshot())
        .mockResolvedValueOnce(createWarmSnapshot({ playheadPosition: 12, schedulerMaxDeliveryLatenessMs: 100.001 }));

    await expect(
        warmPlaybackBeforeReplacement({
            expectedAudioDeviceCount: 58,
            readSnapshot,
            wait: () => Promise.resolve(),
        })
    ).rejects.toThrow(/breached its 100ms look-ahead horizon/);
});

it('closes the dedicated stable Chrome browser after the context closes', async () => {
    const events: string[] = [];
    let connected = true;

    await closeMeasuredBrowser({
        browser: {
            close: () => {
                events.push('browser closed');
                connected = false;
                return Promise.resolve();
            },
            isConnected: () => connected,
        },
        timeoutMs: 1_000,
    });

    expect(events).toEqual(['browser closed']);
});

it('shares one browser shutdown across abort and final cleanup', async () => {
    const browserClose = vi.fn(() => Promise.resolve());
    const close = createMeasuredBrowserCloser({
        browser: { close: browserClose, isConnected: () => false },
        timeoutMs: 1_000,
    });

    await Promise.all([close(), close()]);
    await close();

    expect(browserClose).toHaveBeenCalledOnce();
});

it('retries a browser shutdown that failed while Chrome remained connected', async () => {
    let connected = true;
    const browserClose = vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(new Error('close timed out'))
        .mockImplementationOnce(() => {
            connected = false;
            return Promise.resolve();
        });
    const close = createMeasuredBrowserCloser({
        browser: { close: browserClose, isConnected: () => connected },
        timeoutMs: 1_000,
    });

    await expect(close()).rejects.toThrow('close timed out');
    await close();

    expect(browserClose).toHaveBeenCalledTimes(2);
    expect(connected).toBe(false);
});

it('accepts a timed-out close only after stable Chrome has disconnected', async () => {
    let connected = true;

    await closeMeasuredBrowser({
        browser: {
            close: () => {
                connected = false;
                return new Promise(() => undefined);
            },
            isConnected: () => connected,
        },
        timeoutMs: 1,
    });

    expect(connected).toBe(false);
});

it('aborts and drains a losing operation before surfacing a page error', async () => {
    const events: string[] = [];
    let emitPageError = (_error: Error): void => undefined;
    let finishOperation = (): void => undefined;
    const page: Parameters<typeof rejectOnPageErrorDuring>[0]['page'] = {
        on: (_event, listener) => {
            emitPageError = listener;
        },
        off: () => {
            events.push('listener removed');
        },
    };
    const operation = new Promise<void>((resolve) => {
        finishOperation = () => {
            events.push('operation settled');
            resolve();
        };
    });
    const result = rejectOnPageErrorDuring({
        abort: () => {
            events.push('abort');
            finishOperation();
            return Promise.resolve();
        },
        captureBeforeAbort: () => {
            events.push('failure evidence captured');
            return Promise.resolve();
        },
        label: 'Test operation',
        operation: () => operation,
        page,
        timeoutMs: 1_000,
    });
    emitPageError(new Error('page failed'));
    await expect(result).rejects.toThrow('page failed');
    expect(events).toEqual(['failure evidence captured', 'abort', 'operation settled', 'listener removed']);
});

it('uses a page-error monitor inherited from measured-page setup without replacing its listener', async () => {
    const events: string[] = [];
    let rejectPageError = (_error: Error): void => undefined;
    let finishOperation = (): void => undefined;
    const pageError = new Promise<never>((_resolve, reject) => {
        rejectPageError = reject;
    });
    const operation = new Promise<void>((resolve) => {
        finishOperation = resolve;
    });
    const result = rejectOnPageErrorDuring({
        abort: () => {
            events.push('abort');
            finishOperation();
            return Promise.resolve();
        },
        label: 'Inherited page-error monitor',
        operation: () => operation,
        page: {
            on: () => events.push('listener installed'),
            off: () => events.push('listener removed'),
        },
        pageError,
        timeoutMs: 1_000,
    });

    rejectPageError(new Error('setup-era renderer fault'));

    await expect(result).rejects.toThrow('setup-era renderer fault');
    expect(events).toEqual(['abort']);
});

it('removes the page-error listener and aborts when an operation throws synchronously', async () => {
    const events: string[] = [];
    const page: Parameters<typeof rejectOnPageErrorDuring>[0]['page'] = {
        on: () => {
            events.push('listener installed');
        },
        off: () => {
            events.push('listener removed');
        },
    };

    await expect(
        rejectOnPageErrorDuring({
            abort: () => {
                events.push('abort');
                return Promise.resolve();
            },
            label: 'Synchronous operation',
            operation: () => {
                throw new Error('operation failed synchronously');
            },
            page,
            timeoutMs: 1_000,
        })
    ).rejects.toThrow('operation failed synchronously');

    expect(events).toEqual(['listener installed', 'abort', 'listener removed']);
});
