import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    createYeastWorker as createYeastWorkerClient,
    type YeastWorkerResult,
    YEAST_WORKER_DEADLINE_MS,
} from '../YeastWorkerClient';

import type { MidiEvent, TransportInfo } from '../../models/MidiEvent';
import type { YeastPreviewBlock, YeastPreviewEvent } from '../../models/YeastPreviewSnapshot';
import type { YeastProcessorCommand } from '../../models/YeastProcessorCommand';
import type { YeastProcessorProjection } from '../../models/YeastProcessorProjection';

/**
 * A controllable Worker stand-in. Captures posted messages and lets a
 * test drive the `onmessage` reply channel, so we can exercise the
 * processBlock correlation, timeout, and destroy paths without a real Worker.
 */
type FakeWorker = {
    postMessage: ReturnType<typeof vi.fn>;
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
    onmessageerror: ((event: MessageEvent) => void) | null;
    terminate: ReturnType<typeof vi.fn>;
};

function makeContext(): BaseAudioContext {
    return {} as BaseAudioContext;
}

const transport: TransportInfo = {
    bpm: 120,
    isPlaying: true,
    sampleRate: 48000,
    ppq: 960,
    positionSamples: 0,
} as unknown as TransportInfo;

let installedWorkers: FakeWorker[] = [];
let acknowledgeReady = true;

beforeEach(() => {
    vi.useFakeTimers();
    installedWorkers = [];
    acknowledgeReady = true;
    globalThis.Worker = class FakeWorker {
        postMessage = vi.fn((message: unknown) => {
            if (
                acknowledgeReady &&
                typeof message === 'object' &&
                message !== null &&
                'type' in message &&
                message.type === 'initialize'
            ) {
                void Promise.resolve().then(() => {
                    this.onmessage?.(new MessageEvent('message', { data: { type: 'ready', protocolVersion: 1 } }));
                    return undefined;
                });
            }
        });
        onmessage: ((event: MessageEvent) => void) | null = null;
        onerror: ((event: ErrorEvent) => void) | null = null;
        onmessageerror: ((event: MessageEvent) => void) | null = null;
        terminate = vi.fn();

        constructor() {
            installedWorkers.push(this);
        }
    } as unknown as typeof Worker;
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

function lastWorker(): FakeWorker {
    const worker = installedWorkers.at(-1);
    if (!worker) {
        throw new Error('no Worker was created');
    }
    return worker;
}

async function createYeastWorker(context: BaseAudioContext): Promise<YeastWorkerResult> {
    const node = await createYeastWorkerClient(context);
    lastWorker().postMessage.mockClear();
    return node;
}

function replyReady(worker: FakeWorker, protocolVersion: unknown = 1): void {
    worker.onmessage?.({ data: { type: 'ready', protocolVersion } } as MessageEvent);
}

function triggerWorkerFailure(worker: FakeWorker, kind: 'error' | 'messageerror', message: string): void {
    if (kind === 'error') {
        worker.onerror?.({
            error: new Error(message),
            message,
            preventDefault: vi.fn(),
        } as unknown as ErrorEvent);
        return;
    }
    worker.onmessageerror?.({ data: message } as MessageEvent);
}

/** Simulate the Worker replying 'processed' for a given requestId. */
function replyProcessed(worker: FakeWorker, requestId: number, events: unknown[] = [], preview?: unknown): void {
    worker.onmessage?.({ data: { type: 'processed', requestId, events, preview } } as MessageEvent);
}

function packPreview(records: readonly YeastPreviewEvent[], droppedEvents = 0): Record<string, unknown> {
    const capacity = 512;
    const eventId = new Float64Array(capacity);
    const phase = new Uint8Array(capacity);
    const beatTime = new Float64Array(capacity);
    const durationBeats = new Float64Array(capacity);
    const pitch = new Uint8Array(capacity);
    const velocity = new Float64Array(capacity);
    const probability = new Float64Array(capacity);
    probability.fill(Number.NaN);
    const flags = new Uint8Array(capacity);
    const rackIds = Array.from({ length: capacity }, () => '');
    const routeIds = Array.from({ length: capacity }, () => '');
    const trackIds = Array.from({ length: capacity }, () => '');
    const processorId = Array.from({ length: capacity }, () => '');
    const provenanceProcessorId = Array.from({ length: capacity }, () => '');
    for (let index = 0; index < records.length; index++) {
        const record = records[index]!;
        eventId[index] = record.eventId;
        phase[index] = record.phase === 'open' ? 0 : 1;
        beatTime[index] = record.beatTime;
        durationBeats[index] = record.durationBeats;
        pitch[index] = record.pitch;
        velocity[index] = record.velocity;
        probability[index] = record.probability ?? Number.NaN;
        flags[index] = (record.realized ? 1 : 0) | (record.bypassed ? 2 : 0) | (record.failed ? 4 : 0);
        rackIds[index] = record.rackId;
        routeIds[index] = record.routeId;
        trackIds[index] = record.trackId;
        processorId[index] = record.processorId ?? '';
    }
    const first = records[0];
    return {
        rackId: first?.rackId ?? 'track-a',
        routeId: first?.routeId ?? 'track-a',
        trackId: first?.trackId ?? 'track-a',
        projectionVersion: first?.projectionVersion ?? 1,
        reset: false,
        count: records.length,
        provenanceCount: 0,
        droppedEvents,
        eventId,
        phase,
        beatTime,
        durationBeats,
        pitch,
        velocity,
        probability,
        flags,
        rackIds,
        routeIds,
        trackIds,
        processorId,
        provenanceEventCount: new Uint16Array(capacity),
        provenanceFlags: new Uint8Array(capacity),
        provenanceProcessorId,
    };
}

function replyPreviewPage(worker: FakeWorker, requestId: number, page: unknown, captureEpoch = 1): void {
    worker.onmessage?.({ data: { type: 'previewPage', requestId, captureEpoch, page } } as MessageEvent);
}

function replyProcessedError(worker: FakeWorker, requestId: number, error: string): void {
    worker.onmessage?.({ data: { type: 'processedError', requestId, error } } as MessageEvent);
}

function replyRawProcessed(worker: FakeWorker, data: unknown): void {
    worker.onmessage?.({ data } as MessageEvent);
}

function replyCommandAck(worker: FakeWorker, commandId: number, accepted: boolean, error?: string): void {
    worker.onmessage?.({ data: { type: 'commandAck', commandId, accepted, error } } as MessageEvent);
}

function replyRawCommandAck(worker: FakeWorker, data: unknown): void {
    worker.onmessage?.({ data } as MessageEvent);
}

function replyAllNotesOffAck(
    worker: FakeWorker,
    panicId: number,
    completed: boolean,
    error?: string,
    events: unknown[] = []
): void {
    worker.onmessage?.({
        data: {
            type: 'allNotesOffAck',
            panicId,
            completed,
            error,
            events,
        },
    } as MessageEvent);
}

function replyRawAllNotesOffAck(worker: FakeWorker, data: unknown): void {
    worker.onmessage?.({ data } as MessageEvent);
}

function replyProjectionAck(worker: FakeWorker, projectionId: number, events: unknown[] = []): void {
    worker.onmessage?.({
        data: { type: 'projectionAck', projectionId, events },
    } as MessageEvent);
}

function replyProjectionError(worker: FakeWorker, projectionId: number, error: string): void {
    worker.onmessage?.({ data: { type: 'projectionError', projectionId, error } } as MessageEvent);
}

describe('createYeastWorker — processBlock lifecycle', () => {
    it('resolves processBlock when the worker replies with a matching requestId', async () => {
        const node = await createYeastWorker(makeContext());
        const worker = lastWorker();

        const promise = node.processBlock([], 0, 128, transport, 'track-a');
        // requestId starts at 0 for the first call.
        replyProcessed(worker, 0, []);

        await expect(promise).resolves.toEqual([]);
    });

    it('settles scheduler output before separately validating and dispatching preview', async () => {
        const node = await createYeastWorker(makeContext());
        const worker = lastWorker();
        const onPreview = vi.fn<(preview: YeastPreviewBlock) => void>();
        node.onPreview(onPreview);
        const events: MidiEvent[] = [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 90 } }];
        const record: YeastPreviewEvent = {
            eventId: 1,
            rackId: 'track-a',
            routeId: 'track-a',
            trackId: 'track-a',
            projectionVersion: 1,
            phase: 'closed',
            beatTime: 0,
            durationBeats: 0.5,
            pitch: 60,
            velocity: 90,
            probability: 0.5,
            realized: true,
            processorId: 'arp-1',
            bypassed: false,
            failed: false,
        };

        const promise = node.processBlock(events, 0, 128, transport, 'track-a', true);
        replyProcessed(worker, 0, events);

        await expect(promise).resolves.toBe(events);
        expect(onPreview).not.toHaveBeenCalled();

        replyPreviewPage(worker, 0, packPreview([record]));
        expect(onPreview).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(0);

        expect(onPreview).toHaveBeenCalledWith({
            rackId: 'track-a',
            routeId: 'track-a',
            trackId: 'track-a',
            captureEpoch: 1,
            projectionVersion: 1,
            reset: false,
            records: [record],
            provenance: [],
            droppedEvents: 0,
        });
    });

    it('rejects a late preview page from before capture was disabled and re-enabled', async () => {
        const node = await createYeastWorker(makeContext());
        const worker = lastWorker();
        const onPreview = vi.fn();
        node.onPreview(onPreview);
        const staleRecord: YeastPreviewEvent = {
            eventId: 1,
            rackId: 'track-a',
            routeId: 'track-a',
            trackId: 'track-a',
            projectionVersion: 1,
            phase: 'closed',
            beatTime: 0,
            durationBeats: 0.5,
            pitch: 60,
            velocity: 90,
            probability: null,
            realized: true,
            processorId: null,
            bypassed: false,
            failed: false,
        };
        const currentRecord: YeastPreviewEvent = {
            ...staleRecord,
            eventId: 2,
            pitch: 62,
        };

        const firstEnabled = node.processBlock([], 0, 128, transport, 'track-a', true, 'track-a', 'track-a', 1);
        replyProcessed(worker, 0, []);
        await firstEnabled;

        const disabled = node.processBlock([], 128, 256, transport, 'track-a', false, 'track-a', 'track-a', 2);
        replyProcessed(worker, 1, []);
        await disabled;

        const reenabled = node.processBlock([], 256, 384, transport, 'track-a', true, 'track-a', 'track-a', 3);
        replyProcessed(worker, 2, []);
        await reenabled;

        replyPreviewPage(worker, 0, packPreview([staleRecord]), 1);
        await vi.runAllTimersAsync();
        expect(onPreview).not.toHaveBeenCalled();

        replyPreviewPage(worker, 2, packPreview([currentRecord]), 3);
        await vi.runAllTimersAsync();
        expect(onPreview).toHaveBeenCalledOnce();
        expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ records: [currentRecord], droppedEvents: 0 }));
    });

    it('explicitly releases a disabled preview binding and rejects its in-flight page', async () => {
        const node = await createYeastWorker(makeContext());
        const worker = lastWorker();
        const onPreview = vi.fn();
        node.onPreview(onPreview);
        const route = { rackId: 'rack-a', routeId: 'route-a', trackId: 'track-a', captureEpoch: 7 };
        const processing = node.processBlock(
            [],
            0,
            128,
            transport,
            route.trackId,
            true,
            route.rackId,
            route.routeId,
            route.captureEpoch
        );
        replyProcessed(worker, 0, []);
        await processing;

        node.releasePreview(route);
        replyPreviewPage(
            worker,
            0,
            packPreview([
                {
                    eventId: 1,
                    rackId: route.rackId,
                    routeId: route.routeId,
                    trackId: route.trackId,
                    projectionVersion: 1,
                    phase: 'open',
                    beatTime: 0,
                    durationBeats: 0.5,
                    pitch: 60,
                    velocity: 90,
                    probability: null,
                    realized: true,
                    processorId: null,
                    bypassed: false,
                    failed: false,
                },
            ]),
            route.captureEpoch
        );
        await vi.runAllTimersAsync();

        expect(worker.postMessage).toHaveBeenCalledWith({ type: 'releasePreview', ...route });
        expect(onPreview).not.toHaveBeenCalled();
    });

    it('bounds retained preview routes and rejects a page for the evicted oldest binding', async () => {
        const node = await createYeastWorker(makeContext());
        const worker = lastWorker();
        const onPreview = vi.fn();
        node.onPreview(onPreview);

        for (let index = 0; index <= 512; index++) {
            const trackId = `track-${index}`;
            const processing = node.processBlock([], 0, 128, transport, trackId, true, 'rack-a', trackId, 1);
            replyProcessed(worker, index, []);
            await processing;
        }

        replyPreviewPage(
            worker,
            0,
            packPreview([
                {
                    eventId: 1,
                    rackId: 'rack-a',
                    routeId: 'track-0',
                    trackId: 'track-0',
                    projectionVersion: 1,
                    phase: 'open',
                    beatTime: 0,
                    durationBeats: 0,
                    pitch: 60,
                    velocity: 90,
                    probability: null,
                    realized: true,
                    processorId: null,
                    bypassed: false,
                    failed: false,
                },
            ])
        );
        await vi.runAllTimersAsync();

        expect(onPreview).not.toHaveBeenCalled();
    });

    it('invalidates queued delivery when one route identity is rebound to another track', async () => {
        const node = await createYeastWorker(makeContext());
        const worker = lastWorker();
        const onPreview = vi.fn<(preview: YeastPreviewBlock) => void>();
        node.onPreview(onPreview);
        const recordA: YeastPreviewEvent = {
            eventId: 1,
            rackId: 'rack-a',
            routeId: 'shared-route',
            trackId: 'track-a',
            projectionVersion: 1,
            phase: 'open',
            beatTime: 0,
            durationBeats: 0.5,
            pitch: 60,
            velocity: 90,
            probability: null,
            realized: true,
            processorId: null,
            bypassed: false,
            failed: false,
        };
        const recordB: YeastPreviewEvent = {
            ...recordA,
            eventId: 2,
            trackId: 'track-b',
            pitch: 67,
        };

        const trackA = node.processBlock([], 0, 128, transport, 'track-a', true, 'rack-a', 'shared-route', 1);
        replyProcessed(worker, 0, []);
        await trackA;
        replyPreviewPage(worker, 0, packPreview([recordA]), 1);

        const trackB = node.processBlock([], 128, 256, transport, 'track-b', true, 'rack-a', 'shared-route', 1);
        replyProcessed(worker, 1, []);
        await trackB;
        replyPreviewPage(worker, 1, packPreview([recordB]), 1);
        await vi.runAllTimersAsync();

        expect(onPreview).toHaveBeenCalledOnce();
        expect(onPreview).toHaveBeenCalledWith(
            expect.objectContaining({
                rackId: 'rack-a',
                routeId: 'shared-route',
                trackId: 'track-b',
                records: [recordB],
            })
        );
    });

    it('keeps an enabled route accepted when another route disables capture', async () => {
        const node = await createYeastWorker(makeContext());
        const worker = lastWorker();
        const onPreview = vi.fn();
        node.onPreview(onPreview);
        const routeARecord: YeastPreviewEvent = {
            eventId: 1,
            rackId: 'track-a',
            routeId: 'track-a',
            trackId: 'track-a',
            projectionVersion: 1,
            phase: 'closed',
            beatTime: 0,
            durationBeats: 0.5,
            pitch: 60,
            velocity: 90,
            probability: null,
            realized: true,
            processorId: null,
            bypassed: false,
            failed: false,
        };

        const routeA = node.processBlock([], 0, 128, transport, 'track-a', true);
        replyProcessed(worker, 0, []);
        await routeA;

        const disabledRouteB = node.processBlock([], 0, 128, transport, 'track-b', false);
        replyProcessed(worker, 1, []);
        await disabledRouteB;

        replyPreviewPage(worker, 0, packPreview([routeARecord]), 1);
        await vi.runAllTimersAsync();

        expect(onPreview).toHaveBeenCalledOnce();
        expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ records: [routeARecord] }));
    });

    it('queues deferred preview pages independently for enabled routes', async () => {
        const node = await createYeastWorker(makeContext());
        const worker = lastWorker();
        const onPreview = vi.fn<(preview: YeastPreviewBlock) => void>();
        node.onPreview(onPreview);
        const routeARecord: YeastPreviewEvent = {
            eventId: 1,
            rackId: 'track-a',
            routeId: 'track-a',
            trackId: 'track-a',
            projectionVersion: 1,
            phase: 'closed',
            beatTime: 0,
            durationBeats: 0.5,
            pitch: 60,
            velocity: 90,
            probability: null,
            realized: true,
            processorId: null,
            bypassed: false,
            failed: false,
        };
        const routeBRecord: YeastPreviewEvent = {
            ...routeARecord,
            eventId: 2,
            rackId: 'track-b',
            routeId: 'track-b',
            trackId: 'track-b',
            pitch: 67,
        };

        const routeA = node.processBlock([], 0, 128, transport, 'track-a', true);
        const routeB = node.processBlock([], 0, 128, transport, 'track-b', true);
        replyProcessed(worker, 0, []);
        replyProcessed(worker, 1, []);
        await Promise.all([routeA, routeB]);

        replyPreviewPage(worker, 0, packPreview([routeARecord]), 1);
        replyPreviewPage(worker, 1, packPreview([routeBRecord]), 1);
        await vi.runAllTimersAsync();

        expect(onPreview).toHaveBeenCalledTimes(2);
        expect(onPreview.mock.calls.map(([block]) => block.routeId)).toEqual(['track-a', 'track-b']);
    });

    it('rejects a deferred preview page whose route does not match its accepted request', async () => {
        const node = await createYeastWorker(makeContext());
        const worker = lastWorker();
        const onPreview = vi.fn();
        node.onPreview(onPreview);
        const mismatchedRecord: YeastPreviewEvent = {
            eventId: 1,
            rackId: 'track-b',
            routeId: 'track-b',
            trackId: 'track-b',
            projectionVersion: 1,
            phase: 'closed',
            beatTime: 0,
            durationBeats: 0.5,
            pitch: 60,
            velocity: 90,
            probability: null,
            realized: true,
            processorId: null,
            bypassed: false,
            failed: false,
        };

        const routeA = node.processBlock([], 0, 128, transport, 'track-a', true);
        replyProcessed(worker, 0, []);
        await routeA;

        replyPreviewPage(worker, 0, packPreview([mismatchedRecord]), 1);
        await vi.runAllTimersAsync();

        expect(onPreview).not.toHaveBeenCalled();
    });

    it('does not inspect an embedded preview payload on the correlated scheduler reply', async () => {
        const node = await createYeastWorker(makeContext());
        const worker = lastWorker();
        const events: MidiEvent[] = [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 90 } }];
        let previewFieldReads = 0;
        const embeddedRecord = {
            get beatTime() {
                previewFieldReads += 1;
                return 0;
            },
            durationBeats: 0.5,
            pitch: 60,
            velocity: 90,
            probability: null,
            realized: true,
            processorId: 'legacy-preview',
            bypassed: false,
            failed: false,
        };

        const promise = node.processBlock(events, 0, 128, transport, 'track-a', true);
        replyProcessed(worker, 0, events, { records: [embeddedRecord], droppedEvents: 0 });

        await expect(promise).resolves.toBe(events);
        expect(previewFieldReads).toBe(0);
    });

    it('discards a malformed deferred preview page without delaying scheduler output', async () => {
        const node = await createYeastWorker(makeContext());
        const worker = lastWorker();
        const onPreview = vi.fn();
        node.onPreview(onPreview);
        const events: MidiEvent[] = [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 90 } }];

        const promise = node.processBlock(events, 0, 128, transport, 'track-a', true);
        replyProcessed(worker, 0, events);
        await expect(promise).resolves.toBe(events);

        replyPreviewPage(worker, 0, { count: 1, droppedEvents: 0 });
        await vi.advanceTimersByTimeAsync(0);
        expect(onPreview).not.toHaveBeenCalled();
    });

    it('snapshots observers and accounts preview queue overload without reentrancy', async () => {
        const node = await createYeastWorker(makeContext());
        const worker = lastWorker();
        const lateObserver = vi.fn();
        const stableObserver = vi.fn();
        let unsubscribeFirst = (): void => {};
        const firstObserver = vi.fn(() => {
            unsubscribeFirst();
            node.onPreview(lateObserver);
            throw new Error('observer failed');
        });
        unsubscribeFirst = node.onPreview(firstObserver);
        node.onPreview(stableObserver);
        const record: YeastPreviewEvent = {
            eventId: 1,
            rackId: 'track-a',
            routeId: 'track-a',
            trackId: 'track-a',
            projectionVersion: 1,
            phase: 'closed',
            beatTime: 0,
            durationBeats: 0.5,
            pitch: 60,
            velocity: 90,
            probability: null,
            realized: true,
            processorId: null,
            bypassed: false,
            failed: false,
        };

        const requests = [
            node.processBlock([], 0, 128, transport, 'track-a', true),
            node.processBlock([], 128, 256, transport, 'track-a', true),
            node.processBlock([], 256, 384, transport, 'track-a', true),
        ];
        replyProcessed(worker, 0, []);
        replyProcessed(worker, 1, []);
        replyProcessed(worker, 2, []);
        await Promise.all(requests);

        replyPreviewPage(worker, 0, packPreview([record]));
        replyPreviewPage(worker, 1, packPreview([record]));
        replyPreviewPage(worker, 2, packPreview([record]));
        expect(firstObserver).not.toHaveBeenCalled();
        expect(stableObserver).not.toHaveBeenCalled();

        await vi.runAllTimersAsync();

        expect(firstObserver).toHaveBeenCalledTimes(1);
        expect(stableObserver).toHaveBeenCalledTimes(1);
        expect(lateObserver).not.toHaveBeenCalled();
        expect(stableObserver.mock.calls[0]?.[0]).toMatchObject({ droppedEvents: 2 });

        const nextRequest = node.processBlock([], 384, 512, transport, 'track-a', true);
        replyProcessed(worker, 3, []);
        await nextRequest;
        replyPreviewPage(worker, 3, packPreview([record]));
        await vi.runAllTimersAsync();

        expect(firstObserver).toHaveBeenCalledTimes(1);
        expect(stableObserver).toHaveBeenCalledTimes(2);
        expect(lateObserver).toHaveBeenCalledTimes(1);
    });

    it('drops a queued preview delivery when the client becomes stale', async () => {
        const node = await createYeastWorker(makeContext());
        const worker = lastWorker();
        const onPreview = vi.fn();
        node.onPreview(onPreview);
        const record: YeastPreviewEvent = {
            eventId: 1,
            rackId: 'track-a',
            routeId: 'track-a',
            trackId: 'track-a',
            projectionVersion: 1,
            phase: 'closed',
            beatTime: 0,
            durationBeats: 0.5,
            pitch: 60,
            velocity: 90,
            probability: null,
            realized: true,
            processorId: null,
            bypassed: false,
            failed: false,
        };

        const promise = node.processBlock([], 0, 128, transport, 'track-a', true);
        replyProcessed(worker, 0, []);
        await promise;
        replyPreviewPage(worker, 0, packPreview([record]));
        node.destroy();
        await vi.runAllTimersAsync();

        expect(onPreview).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('rejects processBlock immediately on a correlated worker error', async () => {
        const node = await createYeastWorker(makeContext());
        const worker = lastWorker();
        const promise = node.processBlock([], 0, 128, transport, 'track-a');
        const assertion = expect(promise).rejects.toThrow('rack process failed');

        replyProcessedError(worker, 0, 'rack process failed');

        await assertion;
        expect(vi.getTimerCount()).toBe(0);
    });

    it('includes the originating track in every block request', async () => {
        const node = await createYeastWorker(makeContext());
        const worker = lastWorker();
        const promise = node.processBlock([], 0, 128, transport, 'track-a');

        expect(worker.postMessage).toHaveBeenCalledWith({
            type: 'processBlock',
            requestId: 0,
            captureEpoch: 0,
            events: [],
            blockStart: 0,
            blockEnd: 128,
            transport,
            rackId: 'track-a',
            routeId: 'track-a',
            trackId: 'track-a',
            previewEnabled: false,
            preserveInputTrackIds: false,
        });

        replyProcessed(worker, 0, []);
        await expect(promise).resolves.toEqual([]);
    });

    it('forwards route-preservation requests to the Worker protocol', async () => {
        const node = await createYeastWorker(makeContext());
        const worker = lastWorker();
        const promise = node.processBlock([], 0, 128, transport, 'track-a', false, 'rack-a', 'track-a', 0, true);

        expect(worker.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'processBlock',
                trackId: 'track-a',
                preserveInputTrackIds: true,
            })
        );

        replyProcessed(worker, 0, []);
        await expect(promise).resolves.toEqual([]);
    });

    it('allocates preview route state only while capture is enabled and removes it on disable', async () => {
        const node = await createYeastWorker(makeContext());
        const worker = lastWorker();
        const arrayFrom = vi.spyOn(Array, 'from');

        const disabled = node.processBlock([], 0, 128, transport, 'track-a', false, 'rack-a', 'track-a', 0);
        expect(arrayFrom).not.toHaveBeenCalled();
        replyProcessed(worker, 0, []);
        await disabled;

        const enabled = node.processBlock([], 128, 256, transport, 'track-a', true, 'rack-a', 'track-a', 11);
        expect(arrayFrom).toHaveBeenCalledTimes(1);
        replyProcessed(worker, 1, []);
        await enabled;

        const disabledAgain = node.processBlock([], 256, 384, transport, 'track-a', false, 'rack-a', 'track-a', 12);
        expect(arrayFrom).toHaveBeenCalledTimes(1);
        replyProcessed(worker, 2, []);
        await disabledAgain;

        const reenabled = node.processBlock([], 384, 512, transport, 'track-a', true, 'rack-a', 'track-a', 13);
        expect(arrayFrom).toHaveBeenCalledTimes(2);
        replyProcessed(worker, 3, []);
        await reenabled;
    });

    it('ignores wrong, duplicate, and late processed replies', async () => {
        const node = await createYeastWorker(makeContext());
        const worker = lastWorker();
        const event = {
            timeSamples: 0,
            durationSamples: 24_000,
            durationPpq: 1,
            kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
        };

        const first = node.processBlock([], 0, 128, transport, 'track-a');
        replyProcessed(worker, 99, [event]);
        replyProcessed(worker, 0, [event]);
        replyProcessed(worker, 0, [event]);
        await expect(first).resolves.toEqual([event]);

        const second = node.processBlock([], 128, 256, transport, 'track-a');
        replyProcessed(worker, 0, [event]);
        replyProcessed(worker, 1, []);
        await expect(second).resolves.toEqual([]);
    });

    it.each([
        ['missing events', { type: 'processed', requestId: 0 }],
        ['malformed events', { type: 'processed', requestId: 0, events: [{ nope: true }] }],
        [
            'non-string source event identity',
            {
                type: 'processed',
                requestId: 0,
                events: [
                    {
                        timeSamples: 0,
                        sourceEventId: 7,
                        kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
                    },
                ],
            },
        ],
        [
            'non-string note instance identity',
            {
                type: 'processed',
                requestId: 0,
                events: [
                    {
                        timeSamples: 0,
                        noteInstanceId: {},
                        kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
                    },
                ],
            },
        ],
        [
            'non-finite PPQ position',
            {
                type: 'processed',
                requestId: 0,
                events: [
                    {
                        timeSamples: 0,
                        timePpq: Number.NaN,
                        kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
                    },
                ],
            },
        ],
        [
            'non-numeric endpoint tempo',
            {
                type: 'processed',
                requestId: 0,
                events: [
                    {
                        timeSamples: 0,
                        tempoBpm: '120',
                        kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
                    },
                ],
            },
        ],
        [
            'negative duration hint',
            {
                type: 'processed',
                requestId: 0,
                events: [
                    {
                        timeSamples: 0,
                        durationSamples: -1,
                        kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
                    },
                ],
            },
        ],
        [
            'non-finite PPQ duration hint',
            {
                type: 'processed',
                requestId: 0,
                events: [
                    {
                        timeSamples: 0,
                        durationPpq: Number.NaN,
                        kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
                    },
                ],
            },
        ],
        [
            'non-string track id',
            {
                type: 'processed',
                requestId: 0,
                events: [
                    {
                        timeSamples: 0,
                        trackId: 5,
                        kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
                    },
                ],
            },
        ],
        [
            'noteOff with an out-of-range channel',
            {
                type: 'processed',
                requestId: 0,
                events: [
                    {
                        timeSamples: 0,
                        kind: { type: 'noteOff', channel: 16, note: 60 },
                    },
                ],
            },
        ],
        [
            'cc with a non-numeric controller',
            {
                type: 'processed',
                requestId: 0,
                events: [
                    {
                        timeSamples: 0,
                        kind: { type: 'cc', channel: 0, cc: 'mod', value: 64 },
                    },
                ],
            },
        ],
        [
            'pitchBend with a non-finite value',
            {
                type: 'processed',
                requestId: 0,
                events: [
                    {
                        timeSamples: 0,
                        kind: { type: 'pitchBend', channel: 0, value: Number.POSITIVE_INFINITY },
                    },
                ],
            },
        ],
        [
            'channelPressure with a missing channel',
            {
                type: 'processed',
                requestId: 0,
                events: [
                    {
                        timeSamples: 0,
                        kind: { type: 'channelPressure', value: 10 },
                    },
                ],
            },
        ],
        [
            'unknown event kind',
            {
                type: 'processed',
                requestId: 0,
                events: [
                    {
                        timeSamples: 0,
                        kind: { type: 'unknown' },
                    },
                ],
            },
        ],
    ] as const)('times out instead of accepting %s as silence', async (_label, message) => {
        const node = await createYeastWorker(makeContext());
        const promise = node.processBlock([], 0, 128, transport, 'track-a');
        const assertion = expect(promise).rejects.toThrow(/timed out/);

        replyRawProcessed(lastWorker(), message);
        await vi.advanceTimersByTimeAsync(YEAST_WORKER_DEADLINE_MS);

        await assertion;
    });

    it('rejects processBlock when the worker never replies (no leaked Promise)', async () => {
        const node = await createYeastWorker(makeContext());

        const promise = node.processBlock([], 0, 128, transport, 'track-a');
        // Attach the rejection expectation before advancing timers so the
        // rejection is always observed (no unhandled-rejection noise).
        const assertion = expect(promise).rejects.toThrow(/timed out/);

        await vi.advanceTimersByTimeAsync(YEAST_WORKER_DEADLINE_MS);

        await assertion;
    });

    it('rejects processBlock within the scheduler-safe deadline', async () => {
        const node = await createYeastWorker(makeContext());
        const promise = node.processBlock([], 0, 128, transport, 'track-a');
        let rejection: unknown;
        void promise.catch((error: unknown) => {
            rejection = error;
        });

        await vi.advanceTimersByTimeAsync(YEAST_WORKER_DEADLINE_MS);

        expect(rejection).toBeInstanceOf(Error);
        expect(String((rejection as Error).message)).toMatch(/timed out/);
    });

    it('clears the timeout on a normal reply so it does not reject afterwards', async () => {
        const node = await createYeastWorker(makeContext());
        const worker = lastWorker();

        const promise = node.processBlock([], 0, 128, transport, 'track-a');
        const onReject = vi.fn();
        promise.catch(onReject);
        replyProcessed(worker, 0, [{ timeSamples: 1, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }]);
        await expect(promise).resolves.toHaveLength(1);

        // Advancing past the timeout must not reject the already-resolved
        // Promise: the pending entry was settled and its timer cleared.
        await vi.advanceTimersByTimeAsync(10000);
        expect(onReject).not.toHaveBeenCalled();
    });

    it('rejects all in-flight processBlock Promises when destroyed', async () => {
        const node: YeastWorkerResult = await createYeastWorker(makeContext());

        const a = node.processBlock([], 0, 128, transport, 'track-a');
        const b = node.processBlock([], 128, 256, transport, 'track-a');

        node.destroy();

        await expect(a).rejects.toThrow(/destroyed/);
        await expect(b).rejects.toThrow(/destroyed/);
        expect(lastWorker().terminate).toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('createYeastWorker — projection protocol', () => {
    it('posts one complete serializable projection snapshot', async () => {
        const node = await createYeastWorker(makeContext());
        const projection: YeastProcessorProjection = [
            {
                id: 'arp-1',
                type: 'arpeggiator',
                bypassed: false,
                params: { rate_denom: 16 },
            },
            {
                id: 'filter-1',
                type: 'filter',
                bypassed: true,
                params: {},
            },
        ];

        const result = Promise.resolve(node.setProjection(projection));

        replyProjectionAck(lastWorker(), 0);
        await expect(result).resolves.toBeUndefined();

        expect(lastWorker().postMessage).toHaveBeenCalledWith({
            type: 'setProjection',
            projectionId: 0,
            nowSamples: 0,
            processors: projection,
        });
    });

    it('validates projection identity and ignores duplicate and late acknowledgements', async () => {
        const node = await createYeastWorker(makeContext());

        const first = Promise.resolve(node.setProjection([]));
        replyProjectionAck(lastWorker(), 99);
        replyProjectionAck(lastWorker(), 0);
        replyProjectionError(lastWorker(), 0, 'late error');
        await expect(first).resolves.toBeUndefined();

        const second = Promise.resolve(node.setProjection([]));
        replyProjectionAck(lastWorker(), 0);
        replyProjectionAck(lastWorker(), 1);
        await expect(second).resolves.toBeUndefined();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('rejects a projection when execution acknowledgement times out', async () => {
        const node = await createYeastWorker(makeContext());
        const result = Promise.resolve(node.setProjection([]));
        let rejection: unknown;
        void result.catch((error: unknown) => {
            rejection = error;
        });

        await vi.advanceTimersByTimeAsync(YEAST_WORKER_DEADLINE_MS);

        expect(rejection).toBeInstanceOf(Error);
        expect(String((rejection as Error).message)).toMatch(/projection acknowledgement timed out/);
    });

    it('rejects a pending projection when destroyed and clears its timer', async () => {
        const node = await createYeastWorker(makeContext());
        const result = Promise.resolve(node.setProjection([]));

        node.destroy();

        await expect(result).rejects.toThrow(/destroyed before projection acknowledgement/);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('ignores uncorrelated worker note-offs', async () => {
        const node = await createYeastWorker(makeContext());
        const onNotesOff = vi.fn();
        node.onNotesOff(onNotesOff);

        lastWorker().onmessage?.({
            data: {
                type: 'notesOff',
                events: [
                    { timeSamples: 128, kind: { type: 'noteOff', channel: 0, note: 60 } },
                    { timeSamples: 128, kind: { type: 'noteOn', channel: 0, note: 64, velocity: 100 } },
                ],
            },
        } as MessageEvent);

        expect(onNotesOff).not.toHaveBeenCalled();
    });

    it('dispatches projection note-offs only once from the matching acknowledgement', async () => {
        const node = await createYeastWorker(makeContext());
        const onNotesOff = vi.fn();
        node.onNotesOff(onNotesOff);
        const events = [{ timeSamples: 128, trackId: 'track-a', kind: { type: 'noteOff', channel: 0, note: 60 } }];

        const result = node.setProjection([]);
        replyProjectionAck(lastWorker(), 0, events);
        replyProjectionAck(lastWorker(), 0, events);

        await expect(result).resolves.toBeUndefined();
        expect(onNotesOff).toHaveBeenCalledTimes(1);
        expect(onNotesOff).toHaveBeenCalledWith([{ trackId: 'track-a', noteOffs: [{ channel: 0, note: 60 }] }]);
    });

    it('dispatches projection note-offs grouped by their originating track', async () => {
        const node = await createYeastWorker(makeContext());
        const onNotesOff = vi.fn();
        node.onNotesOff(onNotesOff);
        const events = [
            { timeSamples: 128, trackId: 'track-a', kind: { type: 'noteOff', channel: 0, note: 60 } },
            { timeSamples: 128, trackId: 'track-b', kind: { type: 'noteOff', channel: 0, note: 60 } },
        ];

        const result = node.setProjection([]);
        replyProjectionAck(lastWorker(), 0, events);

        await expect(result).resolves.toBeUndefined();
        expect(onNotesOff).toHaveBeenCalledTimes(1);
        expect(onNotesOff).toHaveBeenCalledWith([
            { trackId: 'track-a', noteOffs: [{ channel: 0, note: 60 }] },
            { trackId: 'track-b', noteOffs: [{ channel: 0, note: 60 }] },
        ]);
    });

    it('preserves channel identity while deduplicating only exact note-off identities', async () => {
        const node = await createYeastWorker(makeContext());
        const onNotesOff = vi.fn();
        node.onNotesOff(onNotesOff);
        const events = [
            { timeSamples: 128, trackId: 'track-a', kind: { type: 'noteOff', channel: 1, note: 60 } },
            { timeSamples: 128, trackId: 'track-a', kind: { type: 'noteOff', channel: 2, note: 60 } },
            { timeSamples: 128, trackId: 'track-a', kind: { type: 'noteOff', channel: 2, note: 60 } },
            { timeSamples: 128, trackId: 'track-b', kind: { type: 'noteOff', channel: 2, note: 60 } },
        ];

        const result = node.setProjection([]);
        replyProjectionAck(lastWorker(), 0, events);

        await expect(result).resolves.toBeUndefined();
        expect(onNotesOff).toHaveBeenCalledExactlyOnceWith([
            {
                trackId: 'track-a',
                noteOffs: [
                    { channel: 1, note: 60 },
                    { channel: 2, note: 60 },
                ],
            },
            { trackId: 'track-b', noteOffs: [{ channel: 2, note: 60 }] },
        ]);
    });

    it('does not let a throwing note-off observer block sibling delivery', async () => {
        const node = await createYeastWorker(makeContext());
        const firstObserver = vi.fn(() => {
            throw new Error('observer failed');
        });
        const secondObserver = vi.fn();
        node.onNotesOff(firstObserver);
        node.onNotesOff(secondObserver);
        const events = [{ timeSamples: 128, trackId: 'track-a', kind: { type: 'noteOff', channel: 0, note: 60 } }];

        const result = node.setProjection([]);
        replyProjectionAck(lastWorker(), 0, events);

        await expect(result).resolves.toBeUndefined();
        expect(firstObserver).toHaveBeenCalledTimes(1);
        expect(secondObserver).toHaveBeenCalledTimes(1);
    });

    it('snapshots note-off observers so a self-unsubscribing handler cannot skip a sibling or admit a reentrant one', async () => {
        const node = await createYeastWorker(makeContext());
        const lateObserver = vi.fn();
        let unsubscribeFirst = (): void => {};
        const firstObserver = vi.fn(() => {
            unsubscribeFirst();
            node.onNotesOff(lateObserver);
        });
        const secondObserver = vi.fn();
        unsubscribeFirst = node.onNotesOff(firstObserver);
        node.onNotesOff(secondObserver);
        const events = [{ timeSamples: 128, trackId: 'track-a', kind: { type: 'noteOff', channel: 0, note: 60 } }];

        const result = node.setProjection([]);
        replyProjectionAck(lastWorker(), 0, events);
        await expect(result).resolves.toBeUndefined();

        expect(firstObserver).toHaveBeenCalledTimes(1);
        expect(secondObserver).toHaveBeenCalledTimes(1);
        expect(lateObserver).not.toHaveBeenCalled();

        const second = node.setProjection([]);
        replyProjectionAck(lastWorker(), 1, events);
        await expect(second).resolves.toBeUndefined();
        expect(lateObserver).toHaveBeenCalledTimes(1);
    });

    it('falls silent on wrong, late, or lost projection acknowledgements', async () => {
        const node = await createYeastWorker(makeContext());
        const onNotesOff = vi.fn();
        node.onNotesOff(onNotesOff);
        const events = [{ timeSamples: 128, trackId: 'track-a', kind: { type: 'noteOff', channel: 0, note: 60 } }];

        const result = node.setProjection([]);
        replyProjectionAck(lastWorker(), 99, events);
        const assertion = expect(result).rejects.toThrow(/projection acknowledgement timed out/);
        await vi.advanceTimersByTimeAsync(YEAST_WORKER_DEADLINE_MS);
        await assertion;

        replyProjectionAck(lastWorker(), 0, events);
        expect(onNotesOff).not.toHaveBeenCalled();
    });
});

describe('createYeastWorker — allNotesOff acknowledgement lifecycle', () => {
    it('posts a correlated panic id and resolves after execution acknowledgement', async () => {
        const node = await createYeastWorker(makeContext());

        const result = node.allNotesOff(512);

        expect(lastWorker().postMessage).toHaveBeenCalledWith({ type: 'allNotesOff', panicId: 0, nowSamples: 512 });
        replyAllNotesOffAck(lastWorker(), 0, true, undefined, [
            { timeSamples: 512, trackId: 'track-a', kind: { type: 'noteOff', channel: 0, note: 60 } },
        ]);

        await expect(result).resolves.toBeUndefined();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('rejects a negative execution acknowledgement', async () => {
        const node = await createYeastWorker(makeContext());

        const result = node.allNotesOff(512);
        replyAllNotesOffAck(lastWorker(), 0, false, 'rack panic failed');

        await expect(result).rejects.toThrow('rack panic failed');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('ignores wrong, duplicate, and late acknowledgements', async () => {
        const node = await createYeastWorker(makeContext());
        const onNotesOff = vi.fn();
        node.onNotesOff(onNotesOff);

        const first = node.allNotesOff(512);
        replyRawAllNotesOffAck(lastWorker(), { type: 'allNotesOffAck', panicId: 99, completed: true });
        replyRawAllNotesOffAck(lastWorker(), { type: 'allNotesOffAck', panicId: 0, completed: 'yes' });
        const events = [
            { timeSamples: 512, trackId: 'track-a', kind: { type: 'noteOff', channel: 1, note: 60 } },
            { timeSamples: 512, trackId: 'track-a', kind: { type: 'noteOff', channel: 2, note: 60 } },
            { timeSamples: 512, trackId: 'track-a', kind: { type: 'noteOff', channel: 2, note: 60 } },
        ];
        replyAllNotesOffAck(lastWorker(), 0, true, undefined, events);
        replyAllNotesOffAck(lastWorker(), 0, false, 'late duplicate', events);
        await expect(first).resolves.toBeUndefined();
        expect(onNotesOff).toHaveBeenCalledTimes(1);
        expect(onNotesOff).toHaveBeenCalledWith([
            {
                trackId: 'track-a',
                noteOffs: [
                    { channel: 1, note: 60 },
                    { channel: 2, note: 60 },
                ],
            },
        ]);

        const second = node.allNotesOff(1024);
        replyAllNotesOffAck(lastWorker(), 0, false, 'late acknowledgement');
        replyAllNotesOffAck(lastWorker(), 1, true);

        await expect(second).resolves.toBeUndefined();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('falls silent on wrong, late, or lost panic acknowledgements', async () => {
        const node = await createYeastWorker(makeContext());
        const onNotesOff = vi.fn();
        node.onNotesOff(onNotesOff);
        const events = [{ timeSamples: 512, trackId: 'track-a', kind: { type: 'noteOff', channel: 0, note: 60 } }];

        const result = node.allNotesOff(512);
        replyRawAllNotesOffAck(lastWorker(), { type: 'allNotesOffAck', panicId: 99, completed: true, events });
        const assertion = expect(result).rejects.toThrow(/allNotesOff acknowledgement timed out/);
        await vi.advanceTimersByTimeAsync(1000);
        await assertion;

        replyAllNotesOffAck(lastWorker(), 0, true, undefined, events);
        expect(onNotesOff).not.toHaveBeenCalled();
    });

    it('rejects on a silent worker acknowledgement timeout', async () => {
        const node = await createYeastWorker(makeContext());

        const result = node.allNotesOff(512);
        const assertion = expect(result).rejects.toThrow(/allNotesOff acknowledgement timed out/);

        await vi.advanceTimersByTimeAsync(1000);

        await assertion;
        expect(vi.getTimerCount()).toBe(0);
    });

    it('rejects a pending panic when destroyed and clears its timer', async () => {
        const node = await createYeastWorker(makeContext());

        const result = node.allNotesOff(512);
        node.destroy();

        await expect(result).rejects.toThrow(/destroyed before allNotesOff acknowledgement/);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('converts a synchronous post failure into a rejected panic promise', async () => {
        const node = await createYeastWorker(makeContext());
        const error = new Error('panic post failed');
        lastWorker().postMessage.mockImplementationOnce(() => {
            throw error;
        });

        const result = node.allNotesOff(512);

        await expect(result).rejects.toThrow(error.message);
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('createYeastWorker — command acknowledgement lifecycle', () => {
    it('resolves one accepted acknowledgement and clears its timer', async () => {
        const node = await createYeastWorker(makeContext());
        const command: YeastProcessorCommand = { processorId: 'cm-1', type: 'chordMemory.learn' };

        const result = node.sendCommand(command);

        expect(lastWorker().postMessage).toHaveBeenCalledWith({ type: 'executeCommand', commandId: 0, command });
        replyCommandAck(lastWorker(), 0, true);

        await expect(result).resolves.toEqual({ accepted: true });
        expect(vi.getTimerCount()).toBe(0);
        replyCommandAck(lastWorker(), 0, false, 'late duplicate');
        await vi.advanceTimersByTimeAsync(1000);
        expect(lastWorker().postMessage).toHaveBeenCalledTimes(1);
    });

    it('ignores duplicate and late acknowledgements without settling another command', async () => {
        const node = await createYeastWorker(makeContext());
        const command: YeastProcessorCommand = { processorId: 'cm-1', type: 'chordMemory.learn' };

        const first = node.sendCommand(command);
        replyCommandAck(lastWorker(), 0, true);
        await expect(first).resolves.toEqual({ accepted: true });

        const second = node.sendCommand(command);
        replyCommandAck(lastWorker(), 0, false, 'late duplicate');
        replyCommandAck(lastWorker(), 1, true);

        await expect(second).resolves.toEqual({ accepted: true });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('resolves a negative acknowledgement without reporting acceptance', async () => {
        const node = await createYeastWorker(makeContext());
        const command: YeastProcessorCommand = { processorId: 'cm-1', type: 'chordMemory.clear' };

        const result = node.sendCommand(command);
        replyCommandAck(lastWorker(), 0, false, 'processor rejected command');

        await expect(result).resolves.toEqual({ accepted: false, error: 'processor rejected command' });
    });

    it.each([
        ['non-boolean accepted', { accepted: 'yes' }],
        ['error on accepted acknowledgement', { accepted: true, error: 'unexpected error' }],
        ['non-string rejection error', { accepted: false, error: 42 }],
        ['missing accepted', { error: undefined }],
    ] as const)('normalizes a malformed %s acknowledgement to failure', async (_label, malformed) => {
        const node = await createYeastWorker(makeContext());
        const command: YeastProcessorCommand = { processorId: 'cm-1', type: 'chordMemory.clear' };

        const result = node.sendCommand(command);
        replyRawCommandAck(lastWorker(), { type: 'commandAck', commandId: 0, ...malformed });

        const ack = await result;
        expect(ack.accepted).toBe(false);
        expect(typeof ack.error).toBe('string');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not settle a pending command on a wrong valid command id', async () => {
        const node = await createYeastWorker(makeContext());
        const command: YeastProcessorCommand = { processorId: 'cm-1', type: 'chordMemory.clear' };

        const result = node.sendCommand(command);
        replyRawCommandAck(lastWorker(), { type: 'commandAck', commandId: 99, accepted: true });
        expect(vi.getTimerCount()).toBe(1);

        const assertion = expect(result).rejects.toThrow(/command acknowledgement timed out/);
        await vi.advanceTimersByTimeAsync(1000);
        await assertion;
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
        ['missing', {}],
        ['negative', { commandId: -1 }],
        ['fractional', { commandId: 0.5 }],
        ['string', { commandId: '0' }],
        ['unsafe', { commandId: Number.MAX_SAFE_INTEGER + 1 }],
        ['NaN', { commandId: Number.NaN }],
        ['wrong type', { type: 'notCommandAck', commandId: 0 }],
    ] as const)(
        'does not settle a pending command on malformed acknowledgement data (%s)',
        async (_label, malformedId) => {
            const node = await createYeastWorker(makeContext());
            const command: YeastProcessorCommand = { processorId: 'cm-1', type: 'chordMemory.clear' };

            const result = node.sendCommand(command);
            replyRawCommandAck(lastWorker(), { type: 'commandAck', accepted: true, ...malformedId });

            const assertion = expect(result).rejects.toThrow(/command acknowledgement timed out/);
            await vi.advanceTimersByTimeAsync(1000);
            await assertion;
            expect(vi.getTimerCount()).toBe(0);
        }
    );

    it('rejects a command when the worker acknowledgement is dropped', async () => {
        const node = await createYeastWorker(makeContext());
        const command = { processorId: 'cm-1', type: 'chordMemory.learn' } as const;

        const result = node.sendCommand(command);
        const assertion = expect(result).rejects.toThrow(/command acknowledgement timed out/);

        await vi.advanceTimersByTimeAsync(1000);

        await assertion;
    });

    it('rejects an in-flight command when the node is destroyed and clears its timer', async () => {
        const node = await createYeastWorker(makeContext());
        const command = { processorId: 'cm-1', type: 'chordMemory.clear' } as const;

        const result = node.sendCommand(command);
        node.destroy();

        await expect(result).rejects.toThrow(/destroyed before command acknowledgement/);
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('createYeastWorker — ready and terminal lifecycle', () => {
    it('waits for a validated Worker-ready acknowledgement', async () => {
        acknowledgeReady = false;
        const creation = createYeastWorkerClient(makeContext());
        let settled = false;
        void creation.then(() => {
            settled = true;
            return undefined;
        });

        await Promise.resolve();
        expect(settled).toBe(false);
        expect(lastWorker().postMessage).toHaveBeenCalledWith({ type: 'initialize', protocolVersion: 1 });

        replyReady(lastWorker(), '1');
        await Promise.resolve();
        expect(settled).toBe(false);

        replyReady(lastWorker());
        await expect(creation).resolves.toBeDefined();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('terminates and rejects within the bounded startup deadline when ready never arrives', async () => {
        acknowledgeReady = false;
        const creation = createYeastWorkerClient(makeContext());
        const rejection = creation.catch((error: unknown) => error);

        await vi.advanceTimersByTimeAsync(YEAST_WORKER_DEADLINE_MS);

        const startupError = await rejection;
        expect(startupError).toEqual(expect.any(Error));
        expect((startupError as Error).message).toMatch(/startup timed out/);
        expect(lastWorker().terminate).toHaveBeenCalledTimes(1);
        expect(lastWorker().onmessage).toBeNull();
        expect(lastWorker().onerror).toBeNull();
        expect(lastWorker().onmessageerror).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(['error', 'messageerror'] as const)('rejects startup immediately on Worker %s', async (kind) => {
        acknowledgeReady = false;
        const creation = createYeastWorkerClient(makeContext());
        const rejection = creation.catch((error: unknown) => error);

        triggerWorkerFailure(lastWorker(), kind, 'startup failed');

        await expect(rejection).resolves.toEqual(expect.any(Error));
        expect(lastWorker().terminate).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(['error', 'messageerror'] as const)(
        'terminally fails every in-flight request on Worker %s',
        async (kind) => {
            const node = await createYeastWorker(makeContext());
            const worker = lastWorker();
            const onTerminalError = vi.fn();
            const onNotesOff = vi.fn();
            node.onTerminalError(onTerminalError);
            node.onNotesOff(onNotesOff);

            const block = node.processBlock([], 0, 128, transport, 'track-a').catch((error: unknown) => error);
            const command = node
                .sendCommand({ processorId: 'cm-1', type: 'chordMemory.clear' })
                .catch((error: unknown) => error);
            const panic = node.allNotesOff(128).catch((error: unknown) => error);
            const projection = node.setProjection([]).catch((error: unknown) => error);
            const staleMessageHandler = worker.onmessage;

            triggerWorkerFailure(worker, kind, 'runtime failed');
            staleMessageHandler?.({
                data: {
                    type: 'projectionAck',
                    projectionId: 0,
                    events: [{ timeSamples: 128, trackId: 'track-a', kind: { type: 'noteOff', channel: 0, note: 60 } }],
                },
            } as MessageEvent);

            for (const result of await Promise.all([block, command, panic, projection])) {
                expect(result).toBeInstanceOf(Error);
            }
            expect(onTerminalError).toHaveBeenCalledTimes(1);
            expect(onNotesOff).not.toHaveBeenCalled();
            expect(worker.terminate).toHaveBeenCalledTimes(1);
            expect(worker.onmessage).toBeNull();
            expect(worker.onerror).toBeNull();
            expect(worker.onmessageerror).toBeNull();
            expect(vi.getTimerCount()).toBe(0);

            const postedBeforeLateCalls = worker.postMessage.mock.calls.length;
            const lateCalls = [
                node.processBlock([], 128, 256, transport, 'track-a').catch((error: unknown) => error),
                node.sendCommand({ processorId: 'cm-1', type: 'chordMemory.learn' }).catch((error: unknown) => error),
                node.allNotesOff(256).catch((error: unknown) => error),
                node.setProjection([]).catch((error: unknown) => error),
            ];
            for (const result of await Promise.all(lateCalls)) {
                expect(result).toBeInstanceOf(Error);
            }
            expect(worker.postMessage).toHaveBeenCalledTimes(postedBeforeLateCalls);
            expect(vi.getTimerCount()).toBe(0);
        }
    );

    it.each(['error-first', 'destroy-first'] as const)('terminates exactly once in the %s race', async (order) => {
        const node = await createYeastWorker(makeContext());
        const worker = lastWorker();
        const onTerminalError = vi.fn();
        node.onTerminalError(onTerminalError);
        const capturedErrorHandler = worker.onerror;

        if (order === 'error-first') {
            triggerWorkerFailure(worker, 'error', 'runtime failed');
            node.destroy();
        } else {
            node.destroy();
            capturedErrorHandler?.({
                error: new Error('late error'),
                message: 'late error',
                preventDefault: vi.fn(),
            } as unknown as ErrorEvent);
        }
        node.destroy();

        expect(worker.terminate).toHaveBeenCalledTimes(1);
        expect(onTerminalError).toHaveBeenCalledTimes(order === 'error-first' ? 1 : 0);
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('createYeastWorker constructor lifecycle', () => {
    it('rejects when Worker construction fails', async () => {
        const error = new Error('Worker construction failed');
        globalThis.Worker = class {
            constructor() {
                throw error;
            }
        } as unknown as typeof Worker;

        await expect(createYeastWorkerClient(makeContext())).rejects.toThrow(error.message);
    });
});

describe('createYeastWorker — late observer registration after a terminal state', () => {
    it('fires onTerminalError immediately when registered after a runtime failure', async () => {
        const node = await createYeastWorker(makeContext());
        const worker = lastWorker();

        triggerWorkerFailure(worker, 'error', 'runtime failed');

        // A terminal failure must reach an observer that registers afterwards,
        // otherwise a component mounting after the crash would silently miss it.
        const lateTerminalError = vi.fn();
        node.onTerminalError(lateTerminalError);

        expect(lateTerminalError).toHaveBeenCalledTimes(1);
        expect(lateTerminalError.mock.calls[0]![0]).toBeInstanceOf(Error);
    });

    it('does not fire onTerminalError when registered after an explicit destroy', async () => {
        const node = await createYeastWorker(makeContext());

        node.destroy();

        // Destroy is an intentional teardown (notifyTerminalHandlers: false), not a
        // failure, so a late observer must not be told the worker "failed".
        const lateTerminalError = vi.fn();
        node.onTerminalError(lateTerminalError);

        expect(lateTerminalError).not.toHaveBeenCalled();
    });

    it('returns a no-op unsubscribe for late note-off and preview observers after a failure', async () => {
        const node = await createYeastWorker(makeContext());
        const worker = lastWorker();

        triggerWorkerFailure(worker, 'error', 'runtime failed');

        const lateNotesOff = vi.fn();
        const latePreview = vi.fn();
        const unsubscribeNotesOff = node.onNotesOff(lateNotesOff);
        const unsubscribePreview = node.onPreview(latePreview);

        // Observers registered after terminal never receive anything.
        expect(lateNotesOff).not.toHaveBeenCalled();
        expect(latePreview).not.toHaveBeenCalled();

        // Their unsubscribers are safe no-ops.
        expect(() => {
            unsubscribeNotesOff();
            unsubscribePreview();
        }).not.toThrow();
    });
});
