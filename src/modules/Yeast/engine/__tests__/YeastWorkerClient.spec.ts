import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    createYeastWorker as createYeastWorkerClient,
    type YeastWorkerResult,
    YEAST_WORKER_DEADLINE_MS,
} from '../YeastWorkerClient';

import type { MidiEvent, TransportInfo } from '../../models/MidiEvent';
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
                    this.onmessage?.({ data: { type: 'ready', protocolVersion: 1 } } as MessageEvent);
                    return undefined;
                });
            }
        });
        onmessage: ((event: MessageEvent) => void) | null = null;
        onerror: ((event: ErrorEvent) => void) | null = null;
        onmessageerror: ((event: MessageEvent) => void) | null = null;
        terminate = vi.fn();

        constructor() {
            installedWorkers.push(this as unknown as FakeWorker);
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

    it('dispatches validated preview sidecars without changing the process result', async () => {
        const node = await createYeastWorker(makeContext());
        const worker = lastWorker();
        const onPreview = vi.fn();
        node.onPreview(onPreview);
        const events: MidiEvent[] = [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 90 } }];
        const preview = {
            records: [
                {
                    beatTime: 0,
                    durationBeats: 0.5,
                    pitch: 60,
                    velocity: 90,
                    probability: 0.5,
                    realized: true,
                    processorId: 'arp-1',
                    bypassed: false,
                    failed: false,
                },
            ],
            droppedEvents: 0,
        };

        const promise = node.processBlock(events, 0, 128, transport, 'track-a', true);
        replyProcessed(worker, 0, events, preview);

        await expect(promise).resolves.toBe(events);
        expect(onPreview).toHaveBeenCalledWith(preview);
    });

    it('discards a malformed preview sidecar without delaying valid scheduler output', async () => {
        const node = await createYeastWorker(makeContext());
        const worker = lastWorker();
        const onPreview = vi.fn();
        node.onPreview(onPreview);
        const events: MidiEvent[] = [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 90 } }];

        const promise = node.processBlock(events, 0, 128, transport, 'track-a', true);
        replyProcessed(worker, 0, events, { records: [{ processorId: 'invalid' }], droppedEvents: 0 });

        await expect(promise).resolves.toBe(events);
        expect(onPreview).not.toHaveBeenCalled();
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
            events: [],
            blockStart: 0,
            blockEnd: 128,
            transport,
            trackId: 'track-a',
            previewEnabled: false,
        });

        replyProcessed(worker, 0, []);
        await expect(promise).resolves.toEqual([]);
    });

    it('ignores wrong, duplicate, and late processed replies', async () => {
        const node = await createYeastWorker(makeContext());
        const worker = lastWorker();
        const event = { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } };

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
