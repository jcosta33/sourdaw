import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createYeastWorkletNode, type YeastWorkletNodeResult } from './YeastWorkletNode';

import type { TransportInfo } from '../models/MidiEvent';

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

        await vi.advanceTimersByTimeAsync(5000);

        await assertion;
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
    });
});

describe('createYeastWorkletNode — reorder protocol', () => {
    it('posts a reorder message to the worklet port', async () => {
        const node = await createYeastWorkletNode(makeContextWithAddModule(() => Promise.resolve()));
        node.reorder(2, 0);
        expect(lastPort().postMessage).toHaveBeenCalledWith({ type: 'reorder', fromIdx: 2, toIdx: 0 });
    });
});

describe('ensureWorkletRegistered — failed addModule is retried', () => {
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
