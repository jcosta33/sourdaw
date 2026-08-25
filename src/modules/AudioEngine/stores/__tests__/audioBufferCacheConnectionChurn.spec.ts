import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    BUFFER_STORE,
    flushIndexedDbTasks,
    installFakeAudioIndexedDb,
    META_STORE,
    RECOVERY_STORE,
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
        controls = installFakeAudioIndexedDb({ existingStores: [BUFFER_STORE, META_STORE, RECOVERY_STORE] });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    // Mutation: reverting openDb to `indexedDB.open` per call reds
    // `expect(controls.openRequestCount()).toBe(1)` with the observed 2 — one
    // open for the persist plus one for the single refresh the six reads
    // coalesce into. (7 is what that same mutation gives with refresh
    // coalescing *also* reverted; alone it is 2.)
    it('opens one IndexedDB connection for the whole cached read path', async () => {
        const audioBufferCache = await importCache();
        const now = vi.spyOn(Date, 'now');
        now.mockReturnValue(1_000);

        audioBufferCache.set('pcm', makeAudioBuffer([new Float32Array([0.5, -0.5])]));
        await flushIndexedDbTasks();

        // Past the coalescing window, so the read path really does go to the
        // store — inside it the reads are free and this would measure nothing.
        now.mockReturnValue(100_000);
        audioBufferCache.get('pcm');
        audioBufferCache.get('pcm');
        audioBufferCache.get('pcm');
        audioBufferCache.getWaveformPeaks('pcm', 2);
        audioBufferCache.getWaveformPeaks('pcm', 2);
        audioBufferCache.getWaveformPeaks('pcm', 2);
        await flushIndexedDbTasks();

        // The reads really did reach the store — a cache that silently stopped
        // talking to IndexedDB would also report one open. 100 000 differs from
        // the 1 000 the record was persisted with. The stamp lives on the
        // metadata row from DB_VERSION 2 on; the record keeps its persist-time
        // value, which is the second half of this pair.
        expect(controls.committedMeta.get('pcm')?.lastAccessed).toBe(100_000);
        expect(controls.committed.get('pcm')?.lastAccessed).toBe(1_000);
        expect(controls.openRequestCount()).toBe(1);
        // And the one connection is held, not opened-and-abandoned.
        expect(controls.liveConnectionCount()).toBe(1);
    });

    // Mutation: deleting the `accessRefreshStampById.set(...)` seed from `set()`
    // reds `expect(controls.writeTransactionCount()).toBe(1)` with 2, and
    // `expect(...lastAccessed).toBe(1_000)` with 5 000 — the first read after
    // every persist spends a readwrite get+put rewriting a stamp the persist
    // just wrote.
    it('seeds the coalescing stamp on persist, so reads right after a set cost nothing', async () => {
        const audioBufferCache = await importCache();
        const now = vi.spyOn(Date, 'now');
        now.mockReturnValue(1_000);

        audioBufferCache.set('pcm', makeAudioBuffer([new Float32Array([0.5])]));
        await flushIndexedDbTasks();

        now.mockReturnValue(5_000);
        for (let read = 0; read < 5; read++) {
            audioBufferCache.get('pcm');
            audioBufferCache.getWaveformPeaks('pcm', 1);
        }
        await flushIndexedDbTasks();

        // Ten reads, one transaction total: the persist's own. The record's
        // stamp is still the one the persist wrote, which is what makes the
        // skipped refreshes harmless.
        expect(controls.writeTransactionCount()).toBe(1);
        expect(controls.committed.get('pcm')?.lastAccessed).toBe(1_000);
        expect(mocks.loggerWarn).not.toHaveBeenCalled();
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

        // 69 s after the persist seeded the stamp: the window has elapsed, so
        // the first of these ten reads must refresh and the other nine must not.
        now.mockReturnValue(70_000);
        for (let read = 0; read < 5; read++) {
            audioBufferCache.get('pcm');
            audioBufferCache.getWaveformPeaks('pcm', 1);
        }
        await flushIndexedDbTasks();

        // Exactly one refresh transaction ran, and it committed the new stamp.
        // 70 000 differs from the 1 000 the record was persisted with, so a
        // refresh that never ran cannot pass this.
        expect(controls.writeTransactionCount()).toBe(2);
        expect(controls.committedMeta.get('pcm')?.lastAccessed).toBe(70_000);
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

        // 61 s after the persist seeded the stamp: the window has elapsed.
        now.mockReturnValue(62_000);
        audioBufferCache.get('pcm');
        await flushIndexedDbTasks();
        expect(controls.writeTransactionCount()).toBe(2);
        expect(controls.committedMeta.get('pcm')?.lastAccessed).toBe(62_000);

        // 48 s after the last refresh: inside the window, no transaction.
        now.mockReturnValue(110_000);
        audioBufferCache.get('pcm');
        await flushIndexedDbTasks();
        expect(controls.writeTransactionCount()).toBe(2);
        expect(controls.committedMeta.get('pcm')?.lastAccessed).toBe(62_000);

        // 98 s after the last refresh, though only 50 s after the last read:
        // the window has elapsed and the stamp must move.
        now.mockReturnValue(160_000);
        audioBufferCache.get('pcm');
        await flushIndexedDbTasks();
        expect(controls.writeTransactionCount()).toBe(3);
        expect(controls.committedMeta.get('pcm')?.lastAccessed).toBe(160_000);
    });

    // Mutation: dropping `accessRefreshStampById.delete(id)` from
    // `evictCachedBuffer` reds both closing assertions — the export sits inside
    // the window of a stamp belonging to a buffer that is no longer cached, so
    // no refresh runs (65 transactions, not 66; stamp still 1 000) and the
    // age-based collector never learns the buffer was used.
    it('re-stamps a buffer read back out of IDB after it was evicted from memory', async () => {
        const audioBufferCache = await importCache();
        const now = vi.spyOn(Date, 'now');
        now.mockReturnValue(1_000);

        audioBufferCache.set('evicted', makeAudioBuffer([new Float32Array([0.5])]));
        // The in-memory LRU is bounded at 64 entries, so 64 further buffers
        // push exactly the first one out while its IDB record survives.
        for (let index = 0; index < 64; index++) {
            audioBufferCache.set(`filler-${index}`, makeAudioBuffer([new Float32Array([0.1])]));
        }
        await flushIndexedDbTasks();
        expect(audioBufferCache.has('evicted')).toBe(false);
        // 65 persists, one readwrite transaction each.
        expect(controls.writeTransactionCount()).toBe(65);

        // Still inside the window the persist seeded, and the buffer is no
        // longer resident, so `exportBuffers` reads it back out of IDB. That is
        // a genuine use and must move the stamp.
        now.mockReturnValue(30_000);
        const exported = await audioBufferCache.exportBuffers(['evicted']);
        await flushIndexedDbTasks();

        expect(exported.evicted?.sampleRate).toBe(48_000);
        expect(controls.writeTransactionCount()).toBe(66);
        expect(controls.committedMeta.get('evicted')?.lastAccessed).toBe(30_000);
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
    // `expect(controls.closeCount()).toBe(1)` with 0 — the held connection would
    // block a competing upgrade or delete indefinitely. Deleting only the
    // `versionChangeLatched = true` line reds
    // `expect(controls.openRequestCount()).toBe(1)` with 2: closing without
    // latching is undone by the next caller, which reconnects and re-blocks the
    // upgrade this connection just yielded to.
    it('stays closed after another context asks to upgrade the database', async () => {
        const audioBufferCache = await importCache();

        audioBufferCache.set('first', makeAudioBuffer([new Float32Array([0.5])]));
        await flushIndexedDbTasks();
        expect(controls.openRequestCount()).toBe(1);
        expect(controls.committed.has('first')).toBe(true);

        controls.fireVersionChange();
        expect(controls.closeCount()).toBe(1);
        expect(controls.liveConnectionCount()).toBe(0);

        audioBufferCache.set('second', makeAudioBuffer([new Float32Array([0.25])]));
        audioBufferCache.get('second');
        audioBufferCache.getWaveformPeaks('second', 2);
        await flushIndexedDbTasks();

        // No reconnect, so the competing upgrade stays unblocked.
        expect(controls.openRequestCount()).toBe(1);
        expect(controls.liveConnectionCount()).toBe(0);
        expect(controls.committed.has('second')).toBe(false);

        // The buffer itself is still served from memory, so playback and
        // waveform drawing carry on.
        expect(audioBufferCache.get('second')?.getChannelData(0)[0]).toBe(0.25);
        expect(audioBufferCache.getWaveformPeaks('second', 1)[0]).toBe(0.25);
        expect(mocks.loggerWarn).toHaveBeenCalledWith(
            '[audioBufferCache] Audio buffer persistence failed',
            expect.objectContaining({ id: 'second' })
        );
    });

    // Mutation: deleting the `versionChangeLatched` guard from
    // `refreshAccessTime` reds `expect(refreshWarnings).toHaveLength(0)` with 2
    // — the refresh keeps calling a permanently-rejecting `openDb()`, so every
    // resident id logs once per 60 s window for the life of the page.
    it('stops attempting access-time refreshes once the latch is set', async () => {
        const audioBufferCache = await importCache();
        const now = vi.spyOn(Date, 'now');
        now.mockReturnValue(1_000);

        audioBufferCache.set('pcm', makeAudioBuffer([new Float32Array([0.5])]));
        await flushIndexedDbTasks();

        controls.fireVersionChange();

        // Two separate windows, so a per-window retry would show up twice.
        now.mockReturnValue(100_000);
        audioBufferCache.get('pcm');
        now.mockReturnValue(200_000);
        audioBufferCache.get('pcm');
        await flushIndexedDbTasks();

        const refreshWarnings = mocks.loggerWarn.mock.calls.filter(
            ([message]) => message === '[audioBufferCache] Audio buffer access-time refresh failed'
        );
        expect(refreshWarnings).toHaveLength(0);
        expect(controls.openRequestCount()).toBe(1);
    });

    // Mutation: deleting the `logger.warn` from `exportBuffers`' catch reds
    // `expect(mocks.loggerWarn).toHaveBeenCalledWith(...)` — the export would
    // drop the PCM for every evicted id with no trace at this layer.
    it('reports the ids an export could not read back while latched', async () => {
        const audioBufferCache = await importCache();

        audioBufferCache.set('resident', makeAudioBuffer([new Float32Array([0.5])]));
        audioBufferCache.set('gone', makeAudioBuffer([new Float32Array([0.25])]));
        await flushIndexedDbTasks();
        audioBufferCache.remove('gone');
        await flushIndexedDbTasks();
        mocks.loggerWarn.mockClear();

        controls.fireVersionChange();
        const exported = await audioBufferCache.exportBuffers(['resident', 'gone']);

        // The resident buffer still exports; the evicted one is dropped, which
        // is what makes the file short.
        expect(Object.keys(exported)).toEqual(['resident']);
        expect(mocks.loggerWarn).toHaveBeenCalledWith(
            '[audioBufferCache] Export could not read evicted buffers from IndexedDB',
            expect.objectContaining({ unresolvedIds: ['gone'] })
        );
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

    // Mutation: dropping `mipmapLevel1Cache.clear()` from `clear()` reds
    // `expect(peaksAfterRestore[0]).toBe(0.25)` with 0.5 — the level-1 mipmap is
    // keyed by id alone, `restoreFromIdb`'s publish path calls `audioCacheSet`
    // without clearing waveform state, and every zoom at or beyond 256 samples
    // per bin reads the mipmap, so the new project draws the old one's peaks.
    it('drops the level-1 mipmap on clear(), so a reused id does not draw the old peaks', async () => {
        const audioBufferCache = await importCache();
        const makeRestoreContext = (): Pick<BaseAudioContext, 'createBuffer'> => ({
            createBuffer: (channels: number, length: number, sampleRate: number) =>
                makeAudioBuffer(
                    Array.from({ length: channels }, () => new Float32Array(length)),
                    sampleRate
                ),
        });

        // 512 samples against 1 bin is 512 samples per bin, past the 256
        // threshold where `getWaveformPeaks` reads the mipmap rather than the
        // buffer.
        audioBufferCache.set('pcm', makeAudioBuffer([new Float32Array(512).fill(0.5)]));
        expect(audioBufferCache.getWaveformPeaks('pcm', 1)[0]).toBe(0.5);
        await flushIndexedDbTasks();

        audioBufferCache.clear();
        await flushIndexedDbTasks();
        expect(controls.committed.has('pcm')).toBe(false);

        // A different project puts a different buffer under the same id.
        controls.committed.set('pcm', {
            sampleRate: 48_000,
            numberOfChannels: 1,
            channelData: [new Float32Array(512).fill(0.25)],
            lastAccessed: 1,
            sizeInBytes: 2048,
        });
        const restored = await audioBufferCache.restoreFromIdb({ context: makeRestoreContext() });
        expect(restored).toBe(1);

        const peaksAfterRestore = audioBufferCache.getWaveformPeaks('pcm', 1);
        expect(peaksAfterRestore[0]).toBe(0.25);
    });

    // Mutation: dropping the memo in clear() (`dbPromise = null` before the
    // clear transaction) reds `expect(controls.openRequestCount()).toBe(1)`
    // with 2 and `expect(controls.liveConnectionCount()).toBe(1)` with 2 — the
    // clearing connection is abandoned still open and the next write reconnects,
    // leaving an orphan that blocks any later `versionchange` for the life of
    // the page. Leaking the handle is the entire reason. It is *not* an ordering
    // question: IDB 3.0 §2.7.2 orders overlapping-scope "readwrite"
    // transactions by creation order across the database, with no
    // same-connection qualifier, so a clear and a following write commit in
    // that order however many connections they are spread over.
    it('keeps its connection across clear(), so the handle is not orphaned', async () => {
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
