import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    flushIndexedDbTasks,
    installFakeAudioIndexedDb,
    type FakeAudioIndexedDbControls,
} from './fakeAudioBufferIndexedDb';

const mocks = vi.hoisted(() => ({
    loggerWarn: vi.fn<(...args: unknown[]) => void>(),
    loggerError: vi.fn<(...args: unknown[]) => void>(),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: mocks.loggerWarn, error: mocks.loggerError, info: vi.fn(), debug: vi.fn() },
}));

function makeAudioBuffer(channelData: Float32Array[], sampleRate = 48_000): AudioBuffer {
    return {
        getChannelData: (channelNumber: number) => channelData[channelNumber]!,
        length: channelData[0]?.length ?? 0,
        numberOfChannels: channelData.length,
        sampleRate,
        duration: (channelData[0]?.length ?? 0) / sampleRate,
        copyFromChannel: () => undefined,
        copyToChannel: () => undefined,
    } as unknown as AudioBuffer;
}

async function importCache(): Promise<typeof import('../audioBufferCache').audioBufferCache> {
    const module = await import('../audioBufferCache');
    return module.audioBufferCache;
}

/**
 * audit M-045. `get()` and `getWaveformPeaks()` run per clip per timeline paint,
 * and each one refreshes the buffer's access stamp so the age-based collector
 * does not delete audio the project is actively using. Before the fix every one
 * of those calls opened its own IndexedDB connection and ran its own readwrite
 * get+put transaction, and those transactions queue on the same object store
 * buffer persistence uses.
 *
 * The cache must hold one connection for the process and re-establish it when it
 * goes away, and it must coalesce access-time refreshes into one committed stamp
 * per id per window.
 */
describe('audioBufferCache connection churn (audit M-045)', () => {
    let controls: FakeAudioIndexedDbControls;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
        controls = installFakeAudioIndexedDb();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    // Mutation: reverting openDb to `indexedDB.open` per call reds
    // `expect(controls.openRequestCount()).toBe(1)` with the observed 7 —
    // one open for the persist plus one for each of the six reads.
    it('opens one IndexedDB connection for the whole cached read path', async () => {
        const audioBufferCache = await importCache();

        audioBufferCache.set('pcm', makeAudioBuffer([new Float32Array([0.5, -0.5])]));
        await flushIndexedDbTasks();

        audioBufferCache.get('pcm');
        audioBufferCache.get('pcm');
        audioBufferCache.get('pcm');
        audioBufferCache.getWaveformPeaks('pcm', 2);
        audioBufferCache.getWaveformPeaks('pcm', 2);
        audioBufferCache.getWaveformPeaks('pcm', 2);
        await flushIndexedDbTasks();

        // The reads really did reach the store — a cache that silently stopped
        // talking to IndexedDB would also report one open.
        expect(controls.committed.has('pcm')).toBe(true);
        expect(controls.openRequestCount()).toBe(1);
        // And the one connection is held, not opened-and-abandoned.
        expect(controls.liveConnectionCount()).toBe(1);
    });

    // Mutation: dropping the window check in refreshAccessTime reds
    // `expect(controls.writeTransactionCount()).toBe(2)` with the observed 11 —
    // the persist plus one refresh transaction for each of the ten reads.
    it('coalesces access-time refreshes across repeated reads in one window', async () => {
        const audioBufferCache = await importCache();
        const now = vi.spyOn(Date, 'now');
        now.mockReturnValue(1_000);

        audioBufferCache.set('pcm', makeAudioBuffer([new Float32Array([0.5])]));
        await flushIndexedDbTasks();
        expect(controls.writeTransactionCount()).toBe(1);
        expect(controls.committed.get('pcm')?.lastAccessed).toBe(1_000);

        now.mockReturnValue(5_000);
        for (let read = 0; read < 5; read++) {
            audioBufferCache.get('pcm');
            audioBufferCache.getWaveformPeaks('pcm', 1);
        }
        await flushIndexedDbTasks();

        // Exactly one refresh transaction ran, and it committed the new stamp.
        // 5 000 differs from the 1 000 the record was persisted with, so a
        // refresh that never ran cannot pass this.
        expect(controls.writeTransactionCount()).toBe(2);
        expect(controls.committed.get('pcm')?.lastAccessed).toBe(5_000);
        expect(mocks.loggerWarn).not.toHaveBeenCalled();
    });

    // Mutations: a window that never expires reds the final
    // `writeTransactionCount()` — the collector would see a stamp that stopped
    // moving on a buffer in active use. A *sliding* window (re-stamping on
    // skipped reads) also reds it: the third read is 50 s after the second read
    // but 98 s after the last committed refresh, so it must refresh.
    it('commits a fresh access stamp once the coalescing window has elapsed', async () => {
        const audioBufferCache = await importCache();
        const now = vi.spyOn(Date, 'now');
        now.mockReturnValue(1_000);

        audioBufferCache.set('pcm', makeAudioBuffer([new Float32Array([0.5])]));
        await flushIndexedDbTasks();

        now.mockReturnValue(2_000);
        audioBufferCache.get('pcm');
        await flushIndexedDbTasks();
        expect(controls.writeTransactionCount()).toBe(2);
        expect(controls.committed.get('pcm')?.lastAccessed).toBe(2_000);

        // 48 s after the last refresh: inside the window, no transaction.
        now.mockReturnValue(50_000);
        audioBufferCache.get('pcm');
        await flushIndexedDbTasks();
        expect(controls.writeTransactionCount()).toBe(2);
        expect(controls.committed.get('pcm')?.lastAccessed).toBe(2_000);

        // 98 s after the last refresh, though only 50 s after the last read:
        // the window has elapsed and the stamp must move.
        now.mockReturnValue(100_000);
        audioBufferCache.get('pcm');
        await flushIndexedDbTasks();
        expect(controls.writeTransactionCount()).toBe(3);
        expect(controls.committed.get('pcm')?.lastAccessed).toBe(100_000);
    });

    // Mutation: memoizing the rejected promise (dropping the `catch` that
    // forgets it) reds `expect(controls.committed.has('pcm')).toBe(true)` —
    // one transient open failure would disable persistence for the session.
    it('retries the connection after a failed open instead of memoizing the failure', async () => {
        const audioBufferCache = await importCache();
        const workingOpen = indexedDB.open.bind(indexedDB);
        let failNextOpen = true;
        vi.stubGlobal('indexedDB', {
            open: (name: string, version?: number) => {
                if (!failNextOpen) {
                    return workingOpen(name, version);
                }
                failNextOpen = false;
                const request = {
                    error: new Error('backend unavailable'),
                    result: undefined,
                    onsuccess: null as (() => void) | null,
                    onerror: null as (() => void) | null,
                    onupgradeneeded: null as (() => void) | null,
                };
                setTimeout(() => request.onerror?.(), 0);
                return request;
            },
        });

        audioBufferCache.set('pcm', makeAudioBuffer([new Float32Array([0.5])]));
        await flushIndexedDbTasks();
        expect(controls.committed.has('pcm')).toBe(false);
        expect(mocks.loggerWarn).toHaveBeenCalledWith(
            '[audioBufferCache] Audio buffer persistence failed',
            expect.objectContaining({ id: 'pcm' })
        );

        audioBufferCache.set('pcm', makeAudioBuffer([new Float32Array([0.5])]));
        await flushIndexedDbTasks();
        expect(controls.committed.has('pcm')).toBe(true);
    });

    // Mutations: deleting the `onversionchange` handler reds
    // `expect(controls.closeCount()).toBe(1)` — the held connection would block
    // a competing upgrade or delete indefinitely. Keeping the memo after the
    // close reds `expect(controls.committed.has('second')).toBe(true)`, because
    // a closed connection throws `InvalidStateError` on `transaction()`.
    it('closes and reconnects when another context asks to upgrade the database', async () => {
        const audioBufferCache = await importCache();

        audioBufferCache.set('first', makeAudioBuffer([new Float32Array([0.5])]));
        await flushIndexedDbTasks();
        expect(controls.openRequestCount()).toBe(1);

        controls.fireVersionChange();
        expect(controls.closeCount()).toBe(1);

        audioBufferCache.set('second', makeAudioBuffer([new Float32Array([0.25])]));
        await flushIndexedDbTasks();

        expect(controls.openRequestCount()).toBe(2);
        expect(controls.committed.has('second')).toBe(true);
        expect(controls.liveConnectionCount()).toBe(1);
    });

    // Mutation: deleting the `onclose` handler reds
    // `expect(controls.committed.has('after')).toBe(true)` — the memo would
    // still hold the dead handle, and every later write would throw
    // `InvalidStateError` and be swallowed into a warning.
    it('reconnects after the browser closes the connection abnormally', async () => {
        const audioBufferCache = await importCache();

        audioBufferCache.set('before', makeAudioBuffer([new Float32Array([0.5])]));
        await flushIndexedDbTasks();
        expect(controls.openRequestCount()).toBe(1);

        controls.fireAbnormalClose();

        audioBufferCache.set('after', makeAudioBuffer([new Float32Array([0.25])]));
        await flushIndexedDbTasks();

        expect(controls.openRequestCount()).toBe(2);
        expect(controls.committed.has('after')).toBe(true);
        expect(mocks.loggerWarn).not.toHaveBeenCalled();
    });

    // Mutation: dropping the memo in clear() (`dbPromise = null` before the
    // clear transaction) reds `expect(controls.openRequestCount()).toBe(1)`
    // with 2 and `expect(controls.liveConnectionCount()).toBe(1)` with 2 — the
    // clearing connection is left open and the next write reconnects. The
    // ordering argument for holding the connection is a real-IDB one the double
    // does not adjudicate: transactions are only ordered against each other on
    // the *same* connection, so splitting a clear and a following write across
    // two connections lets the clear wipe the write.
    it('keeps its connection across clear(), so a following write is not lost', async () => {
        const audioBufferCache = await importCache();

        audioBufferCache.set('pcm', makeAudioBuffer([new Float32Array([0.5])]));
        await flushIndexedDbTasks();
        expect(controls.openRequestCount()).toBe(1);

        audioBufferCache.clear();
        audioBufferCache.set('next', makeAudioBuffer([new Float32Array([0.25])]));
        await flushIndexedDbTasks();

        expect(controls.openRequestCount()).toBe(1);
        expect(controls.liveConnectionCount()).toBe(1);
        expect(controls.committed.has('pcm')).toBe(false);
        expect(controls.committed.has('next')).toBe(true);
    });
});
