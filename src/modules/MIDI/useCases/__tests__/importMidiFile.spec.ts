import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readMidiFile } from '../importMidiFile';

/**
 * `readMidiFile` spawns a real `Worker` in production. jsdom has no Worker
 * implementation, so these tests install a controllable stand-in on
 * `globalThis` and drive its `onmessage` by hand. That makes the failure paths
 * — a worker that answers with an error, and a worker that never answers at
 * all — directly observable.
 */
type WorkerStub = {
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: { message: string }) => void) | null;
    postMessage: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
};

const workers: WorkerStub[] = [];

class StubWorker implements WorkerStub {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: { message: string }) => void) | null = null;
    postMessage = vi.fn();
    terminate = vi.fn();

    constructor() {
        workers.push(this);
    }
}

function latestWorker(): WorkerStub {
    const worker = workers[workers.length - 1];
    if (!worker) {
        throw new Error('readMidiFile did not construct a worker');
    }
    return worker;
}

function fakeMidiFile(): File {
    return new File([new Uint8Array([0x4d, 0x54, 0x68, 0x64])], 'song.mid', { type: 'audio/midi' });
}

const originalWorker = Reflect.get(globalThis, 'Worker') as unknown;

describe('readMidiFile', () => {
    beforeEach(() => {
        workers.length = 0;
        Reflect.set(globalThis, 'Worker', StubWorker);
    });

    afterEach(() => {
        vi.useRealTimers();
        Reflect.set(globalThis, 'Worker', originalWorker);
    });

    it('resolves with the parsed tracks the worker posts back', async () => {
        const pending = readMidiFile(fakeMidiFile());
        await vi.waitFor(() => expect(workers).toHaveLength(1));
        const worker = latestWorker();

        const tracks = [{ name: 'Bass', notes: [], endTick: 960 }];
        worker.onmessage?.(new MessageEvent('message', { data: { type: 'parsed', tracks } }));

        await expect(pending).resolves.toEqual(tracks);
        expect(worker.terminate).toHaveBeenCalledTimes(1);
    });

    it('rejects with the worker-reported parse error', async () => {
        const pending = readMidiFile(fakeMidiFile());
        await vi.waitFor(() => expect(workers).toHaveLength(1));

        latestWorker().onmessage?.(
            new MessageEvent('message', { data: { type: 'error', message: 'Not a valid MIDI file' } })
        );

        await expect(pending).rejects.toMatchObject({ message: 'Not a valid MIDI file' });
    });

    it('rejects instead of hanging when the worker never answers', async () => {
        // Fake timers must be installed before the call so the guard timer is
        // the fake one; `advanceTimersByTimeAsync` also flushes the microtask
        // that resolves `file.arrayBuffer()`.
        vi.useFakeTimers();
        // Attach the rejection handler up front: the timer fires inside
        // `advanceTimersByTimeAsync`, before an `await expect(...).rejects`
        // could subscribe, which would surface as an unhandled rejection.
        const settled = readMidiFile(fakeMidiFile()).then(
            () => ({ outcome: 'resolved' as const }),
            (error: unknown) => ({ outcome: 'rejected' as const, error })
        );
        await vi.advanceTimersByTimeAsync(0);
        expect(workers).toHaveLength(1);
        const worker = latestWorker();

        // Nothing is ever posted back — this is the stuck-worker case.
        await vi.advanceTimersByTimeAsync(30_000);

        expect(await settled).toEqual({
            outcome: 'rejected',
            error: expect.objectContaining({ message: 'MIDI import timed out after 30000 ms', _tag: 'Midi' }),
        });
        expect(worker.terminate).toHaveBeenCalledTimes(1);
    });

    it('clears the pending timeout once the worker answers', async () => {
        vi.useFakeTimers();
        const pending = readMidiFile(fakeMidiFile());
        await vi.advanceTimersByTimeAsync(0);

        latestWorker().onmessage?.(new MessageEvent('message', { data: { type: 'parsed', tracks: [] } }));
        await expect(pending).resolves.toEqual([]);

        // A surviving timeout would fire here and reject an already-settled
        // promise, surfacing as an unhandled rejection.
        expect(vi.getTimerCount()).toBe(0);
    });
});
