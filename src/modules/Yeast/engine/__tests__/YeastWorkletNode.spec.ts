import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createYeastWorkletNode, type YeastWorkletNodeResult, YEAST_WORKLET_DEADLINE_MS } from '../YeastWorkletNode';

import type { TransportInfo } from '../../models/MidiEvent';
import type { YeastProcessorCommand } from '../../models/YeastProcessorCommand';
import type { YeastProcessorProjection } from '../../models/YeastProcessorProjection';

/**
 * A controllable AudioWorkletNode stand-in. Captures posted messages and lets a
 * test drive the `onmessage` reply channel, so we can exercise the
 * processBlock correlation, timeout, and destroy paths without a real worklet.
 */
type FakePort = {
    postMessage: ReturnType<typeof vi.fn>;
    onmessage: ((event: MessageEvent) => void) | null;
    close: ReturnType<typeof vi.fn>;
};

function makeContextWithAddModule(addModule: () => Promise<void>): BaseAudioContext {
    return {
        audioWorklet: { addModule },
    } as unknown as BaseAudioContext;
}

const transport: TransportInfo = {
    bpm: 120,
    isPlaying: true,
    sampleRate: 48000,
    ppq: 960,
    positionSamples: 0,
} as unknown as TransportInfo;

let installedPorts: FakePort[] = [];

beforeEach(() => {
    vi.useFakeTimers();
    installedPorts = [];
    // Replace the global AudioWorkletNode stub with one whose port we can drive.
    globalThis.AudioWorkletNode = class FakeAudioWorkletNode {
        port: FakePort;
        constructor() {
            this.port = {
                postMessage: vi.fn(),
                onmessage: null,
                close: vi.fn(),
            };
            installedPorts.push(this.port);
        }
        disconnect(): void {}
    } as unknown as typeof AudioWorkletNode;
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

function lastPort(): FakePort {
    const port = installedPorts.at(-1);
    if (!port) {
        throw new Error('no AudioWorkletNode port was created');
    }
    return port;
}

/** Simulate the worklet replying 'processed' for a given requestId. */
function replyProcessed(port: FakePort, requestId: number, events: unknown[] = []): void {
    port.onmessage?.({ data: { type: 'processed', requestId, events } } as MessageEvent);
}

function replyCommandAck(port: FakePort, commandId: number, accepted: boolean, error?: string): void {
    port.onmessage?.({ data: { type: 'commandAck', commandId, accepted, error } } as MessageEvent);
}

function replyRawCommandAck(port: FakePort, data: unknown): void {
    port.onmessage?.({ data } as MessageEvent);
}

function replyAllNotesOffAck(port: FakePort, panicId: number, completed: boolean, error?: string): void {
    port.onmessage?.({ data: { type: 'allNotesOffAck', panicId, completed, error } } as MessageEvent);
}

function replyRawAllNotesOffAck(port: FakePort, data: unknown): void {
    port.onmessage?.({ data } as MessageEvent);
}

function replyProjectionAck(port: FakePort, projectionId: number): void {
    port.onmessage?.({ data: { type: 'projectionAck', projectionId } } as MessageEvent);
}

function replyProjectionError(port: FakePort, projectionId: number, error: string): void {
    port.onmessage?.({ data: { type: 'projectionError', projectionId, error } } as MessageEvent);
}

describe('createYeastWorkletNode — processBlock lifecycle', () => {
    it('resolves processBlock when the worklet replies with a matching requestId', async () => {
        const node = await createYeastWorkletNode(makeContextWithAddModule(() => Promise.resolve()));
        const port = lastPort();

        const promise = node.processBlock([], 0, 128, transport);
        // requestId starts at 0 for the first call.
        replyProcessed(port, 0, []);

        await expect(promise).resolves.toEqual([]);
    });

    it('rejects processBlock when the worklet never replies (no leaked Promise)', async () => {
        const node = await createYeastWorkletNode(makeContextWithAddModule(() => Promise.resolve()));

        const promise = node.processBlock([], 0, 128, transport);
        // Attach the rejection expectation before advancing timers so the
        // rejection is always observed (no unhandled-rejection noise).
        const assertion = expect(promise).rejects.toThrow(/timed out/);

        await vi.advanceTimersByTimeAsync(YEAST_WORKLET_DEADLINE_MS);

        await assertion;
    });

    it('rejects processBlock within the scheduler-safe deadline', async () => {
        const node = await createYeastWorkletNode(makeContextWithAddModule(() => Promise.resolve()));
        const promise = node.processBlock([], 0, 128, transport);
        let rejection: unknown;
        void promise.catch((error: unknown) => {
            rejection = error;
        });

        await vi.advanceTimersByTimeAsync(YEAST_WORKLET_DEADLINE_MS);

        expect(rejection).toBeInstanceOf(Error);
        expect(String((rejection as Error).message)).toMatch(/timed out/);
    });

    it('clears the timeout on a normal reply so it does not reject afterwards', async () => {
        const node = await createYeastWorkletNode(makeContextWithAddModule(() => Promise.resolve()));
        const port = lastPort();

        const promise = node.processBlock([], 0, 128, transport);
        const onReject = vi.fn();
        promise.catch(onReject);
        replyProcessed(port, 0, [{ timeSamples: 1, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }]);
        await expect(promise).resolves.toHaveLength(1);

        // Advancing past the timeout must not reject the already-resolved
        // Promise: the pending entry was settled and its timer cleared.
        await vi.advanceTimersByTimeAsync(10000);
        expect(onReject).not.toHaveBeenCalled();
    });

    it('rejects all in-flight processBlock Promises when destroyed', async () => {
        const node: YeastWorkletNodeResult = await createYeastWorkletNode(
            makeContextWithAddModule(() => Promise.resolve())
        );

        const a = node.processBlock([], 0, 128, transport);
        const b = node.processBlock([], 128, 256, transport);

        node.destroy();

        await expect(a).rejects.toThrow(/destroyed/);
        await expect(b).rejects.toThrow(/destroyed/);
        expect(lastPort().close).toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('createYeastWorkletNode — projection protocol', () => {
    it('posts one complete serializable projection snapshot', async () => {
        const node = await createYeastWorkletNode(makeContextWithAddModule(() => Promise.resolve()));
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

        replyProjectionAck(lastPort(), 0);
        await expect(result).resolves.toBeUndefined();

        expect(lastPort().postMessage).toHaveBeenCalledWith({
            type: 'setProjection',
            projectionId: 0,
            processors: projection,
        });
    });

    it('validates projection identity and ignores duplicate and late acknowledgements', async () => {
        const node = await createYeastWorkletNode(makeContextWithAddModule(() => Promise.resolve()));

        const first = Promise.resolve(node.setProjection([]));
        replyProjectionAck(lastPort(), 99);
        replyProjectionAck(lastPort(), 0);
        replyProjectionError(lastPort(), 0, 'late error');
        await expect(first).resolves.toBeUndefined();

        const second = Promise.resolve(node.setProjection([]));
        replyProjectionAck(lastPort(), 0);
        replyProjectionAck(lastPort(), 1);
        await expect(second).resolves.toBeUndefined();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('rejects a projection when execution acknowledgement times out', async () => {
        const node = await createYeastWorkletNode(makeContextWithAddModule(() => Promise.resolve()));
        const result = Promise.resolve(node.setProjection([]));
        let rejection: unknown;
        void result.catch((error: unknown) => {
            rejection = error;
        });

        await vi.advanceTimersByTimeAsync(YEAST_WORKLET_DEADLINE_MS);

        expect(rejection).toBeInstanceOf(Error);
        expect(String((rejection as Error).message)).toMatch(/projection acknowledgement timed out/);
    });

    it('rejects a pending projection when destroyed and clears its timer', async () => {
        const node = await createYeastWorkletNode(makeContextWithAddModule(() => Promise.resolve()));
        const result = Promise.resolve(node.setProjection([]));

        node.destroy();

        await expect(result).rejects.toThrow(/destroyed before projection acknowledgement/);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('delivers worklet note-offs to the registered listener', async () => {
        const node = await createYeastWorkletNode(makeContextWithAddModule(() => Promise.resolve()));
        const onNotesOff = vi.fn();
        node.onNotesOff(onNotesOff);

        lastPort().onmessage?.({
            data: {
                type: 'notesOff',
                events: [
                    { timeSamples: 128, kind: { type: 'noteOff', channel: 0, note: 60 } },
                    { timeSamples: 128, kind: { type: 'noteOn', channel: 0, note: 64, velocity: 100 } },
                ],
            },
        } as MessageEvent);

        expect(onNotesOff).toHaveBeenCalledWith([60]);
    });
});

describe('createYeastWorkletNode — allNotesOff acknowledgement lifecycle', () => {
    it('posts a correlated panic id and resolves after execution acknowledgement', async () => {
        const node = await createYeastWorkletNode(makeContextWithAddModule(() => Promise.resolve()));

        const result = node.allNotesOff(512);

        expect(lastPort().postMessage).toHaveBeenCalledWith({ type: 'allNotesOff', panicId: 0, nowSamples: 512 });
        replyAllNotesOffAck(lastPort(), 0, true);

        await expect(result).resolves.toBeUndefined();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('rejects a negative execution acknowledgement', async () => {
        const node = await createYeastWorkletNode(makeContextWithAddModule(() => Promise.resolve()));

        const result = node.allNotesOff(512);
        replyAllNotesOffAck(lastPort(), 0, false, 'rack panic failed');

        await expect(result).rejects.toThrow('rack panic failed');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('ignores wrong, duplicate, and late acknowledgements', async () => {
        const node = await createYeastWorkletNode(makeContextWithAddModule(() => Promise.resolve()));

        const first = node.allNotesOff(512);
        replyRawAllNotesOffAck(lastPort(), { type: 'allNotesOffAck', panicId: 99, completed: true });
        replyRawAllNotesOffAck(lastPort(), { type: 'allNotesOffAck', panicId: 0, completed: 'yes' });
        replyAllNotesOffAck(lastPort(), 0, true);
        replyAllNotesOffAck(lastPort(), 0, false, 'late duplicate');
        await expect(first).resolves.toBeUndefined();

        const second = node.allNotesOff(1024);
        replyAllNotesOffAck(lastPort(), 0, false, 'late acknowledgement');
        replyAllNotesOffAck(lastPort(), 1, true);

        await expect(second).resolves.toBeUndefined();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('rejects on a silent worklet acknowledgement timeout', async () => {
        const node = await createYeastWorkletNode(makeContextWithAddModule(() => Promise.resolve()));

        const result = node.allNotesOff(512);
        const assertion = expect(result).rejects.toThrow(/allNotesOff acknowledgement timed out/);

        await vi.advanceTimersByTimeAsync(1000);

        await assertion;
        expect(vi.getTimerCount()).toBe(0);
    });

    it('rejects a pending panic when destroyed and clears its timer', async () => {
        const node = await createYeastWorkletNode(makeContextWithAddModule(() => Promise.resolve()));

        const result = node.allNotesOff(512);
        node.destroy();

        await expect(result).rejects.toThrow(/destroyed before allNotesOff acknowledgement/);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('converts a synchronous post failure into a rejected panic promise', async () => {
        const node = await createYeastWorkletNode(makeContextWithAddModule(() => Promise.resolve()));
        const error = new Error('panic post failed');
        lastPort().postMessage.mockImplementationOnce(() => {
            throw error;
        });

        const result = node.allNotesOff(512);

        await expect(result).rejects.toThrow(error.message);
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('createYeastWorkletNode — command acknowledgement lifecycle', () => {
    it('resolves one accepted acknowledgement and clears its timer', async () => {
        const node = await createYeastWorkletNode(makeContextWithAddModule(() => Promise.resolve()));
        const command: YeastProcessorCommand = { processorId: 'cm-1', type: 'chordMemory.learn' };

        const result = node.sendCommand(command);

        expect(lastPort().postMessage).toHaveBeenCalledWith({ type: 'executeCommand', commandId: 0, command });
        replyCommandAck(lastPort(), 0, true);

        await expect(result).resolves.toEqual({ accepted: true });
        expect(vi.getTimerCount()).toBe(0);
        replyCommandAck(lastPort(), 0, false, 'late duplicate');
        await vi.advanceTimersByTimeAsync(1000);
        expect(lastPort().postMessage).toHaveBeenCalledTimes(1);
    });

    it('ignores duplicate and late acknowledgements without settling another command', async () => {
        const node = await createYeastWorkletNode(makeContextWithAddModule(() => Promise.resolve()));
        const command: YeastProcessorCommand = { processorId: 'cm-1', type: 'chordMemory.learn' };

        const first = node.sendCommand(command);
        replyCommandAck(lastPort(), 0, true);
        await expect(first).resolves.toEqual({ accepted: true });

        const second = node.sendCommand(command);
        replyCommandAck(lastPort(), 0, false, 'late duplicate');
        replyCommandAck(lastPort(), 1, true);

        await expect(second).resolves.toEqual({ accepted: true });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('resolves a negative acknowledgement without reporting acceptance', async () => {
        const node = await createYeastWorkletNode(makeContextWithAddModule(() => Promise.resolve()));
        const command: YeastProcessorCommand = { processorId: 'cm-1', type: 'chordMemory.clear' };

        const result = node.sendCommand(command);
        replyCommandAck(lastPort(), 0, false, 'processor rejected command');

        await expect(result).resolves.toEqual({ accepted: false, error: 'processor rejected command' });
    });

    it.each([
        ['non-boolean accepted', { accepted: 'yes' }],
        ['error on accepted acknowledgement', { accepted: true, error: 'unexpected error' }],
        ['non-string rejection error', { accepted: false, error: 42 }],
        ['missing accepted', { error: undefined }],
    ] as const)('normalizes a malformed %s acknowledgement to failure', async (_label, malformed) => {
        const node = await createYeastWorkletNode(makeContextWithAddModule(() => Promise.resolve()));
        const command: YeastProcessorCommand = { processorId: 'cm-1', type: 'chordMemory.clear' };

        const result = node.sendCommand(command);
        replyRawCommandAck(lastPort(), { type: 'commandAck', commandId: 0, ...malformed });

        const ack = await result;
        expect(ack.accepted).toBe(false);
        expect(typeof ack.error).toBe('string');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not settle a pending command on a wrong valid command id', async () => {
        const node = await createYeastWorkletNode(makeContextWithAddModule(() => Promise.resolve()));
        const command: YeastProcessorCommand = { processorId: 'cm-1', type: 'chordMemory.clear' };

        const result = node.sendCommand(command);
        replyRawCommandAck(lastPort(), { type: 'commandAck', commandId: 99, accepted: true });
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
            const node = await createYeastWorkletNode(makeContextWithAddModule(() => Promise.resolve()));
            const command: YeastProcessorCommand = { processorId: 'cm-1', type: 'chordMemory.clear' };

            const result = node.sendCommand(command);
            replyRawCommandAck(lastPort(), { type: 'commandAck', accepted: true, ...malformedId });

            const assertion = expect(result).rejects.toThrow(/command acknowledgement timed out/);
            await vi.advanceTimersByTimeAsync(1000);
            await assertion;
            expect(vi.getTimerCount()).toBe(0);
        }
    );

    it('rejects a command when the worklet acknowledgement is dropped', async () => {
        const node = await createYeastWorkletNode(makeContextWithAddModule(() => Promise.resolve()));
        const command = { processorId: 'cm-1', type: 'chordMemory.learn' } as const;

        const result = node.sendCommand(command);
        const assertion = expect(result).rejects.toThrow(/command acknowledgement timed out/);

        await vi.advanceTimersByTimeAsync(1000);

        await assertion;
    });

    it('rejects an in-flight command when the node is destroyed and clears its timer', async () => {
        const node = await createYeastWorkletNode(makeContextWithAddModule(() => Promise.resolve()));
        const command = { processorId: 'cm-1', type: 'chordMemory.clear' } as const;

        const result = node.sendCommand(command);
        node.destroy();

        await expect(result).rejects.toThrow(/destroyed before command acknowledgement/);
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('ensureWorkletRegistered — failed addModule is retried', () => {
    it('rejects a hung addModule within the scheduler-safe deadline', async () => {
        const pending = new Promise<void>(() => {});
        let rejection: unknown;
        void createYeastWorkletNode(makeContextWithAddModule(() => pending)).catch((error: unknown) => {
            rejection = error;
        });

        await vi.advanceTimersByTimeAsync(YEAST_WORKLET_DEADLINE_MS);

        expect(rejection).toBeInstanceOf(Error);
        expect(String((rejection as Error).message)).toMatch(/addModule timed out/);
        expect(installedPorts).toHaveLength(0);
    });

    it('does not cache a rejected addModule; a later call retries', async () => {
        const spy = vi.fn<() => Promise<void>>();
        // First call rejects (e.g. CSP), second resolves.
        spy.mockRejectedValueOnce(new Error('CSP blocked')).mockResolvedValueOnce(undefined);
        const ctx = makeContextWithAddModule(spy);

        await expect(createYeastWorkletNode(ctx)).rejects.toThrow('CSP blocked');
        // The rejection must not be cached for this context — a retry calls
        // addModule again and succeeds.
        await expect(createYeastWorkletNode(ctx)).resolves.toBeDefined();
        expect(spy).toHaveBeenCalledTimes(2);
    });
});
