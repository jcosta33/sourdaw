import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    flushIndexedDbTasks,
    installFakeAudioIndexedDb,
    type FakeAudioIndexedDbControls,
    type StoredAudioBuffer,
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

function storedRecord(channelData: Float32Array[], lastAccessed: number): StoredAudioBuffer {
    return {
        sampleRate: 48_000,
        numberOfChannels: channelData.length,
        channelData,
        lastAccessed,
        sizeInBytes: channelData.reduce((total, channel) => total + channel.byteLength, 0),
    };
}

async function importCache(): Promise<typeof import('../audioBufferCache').audioBufferCache> {
    const module = await import('../audioBufferCache');
    return module.audioBufferCache;
}

describe('audioBufferCache write observation', () => {
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

    // The copy AC-5 makes the audio of record: raw Float32Array structured-cloned
    // into IndexedDB, no base64 anywhere on this path.
    // Mutation: dropping the `await` on the transaction in persistSerializedToIdb
    // and resolving on the put request instead reds `committed.get('pcm')`,
    // because the staged value is not visible until the transaction commits.
    it('commits raw Float32 PCM for a cached buffer before the persist settles', async () => {
        const audioBufferCache = await importCache();
        const left = new Float32Array([0.25, -0.5, 0.75]);
        const right = new Float32Array([-0.25, 0.5, -0.75]);

        audioBufferCache.set('pcm', makeAudioBuffer([left, right]));
        await flushIndexedDbTasks();

        const record = controls.committed.get('pcm');
        expect(record?.numberOfChannels).toBe(2);
        expect(record?.sampleRate).toBe(48_000);
        expect(Array.from(record?.channelData[0] ?? [])).toEqual([0.25, -0.5, 0.75]);
        expect(Array.from(record?.channelData[1] ?? [])).toEqual([-0.25, 0.5, -0.75]);
        expect(record?.sizeInBytes).toBe(24);
        expect(mocks.loggerWarn).not.toHaveBeenCalled();
    });

    // A bare abort fires `abort` and no `error`. Without an `onabort` handler the
    // persist promise never settles, so the failure is invisible and the
    // `finally` cleanup never runs.
    // Mutation: deleting `tx.onabort = …` from persistSerializedToIdb reds
    // `expect(mocks.loggerWarn).toHaveBeenCalledWith(…)` — the promise hangs and
    // nothing is ever reported.
    it('reports a buffer persist whose transaction aborts', async () => {
        const audioBufferCache = await importCache();
        controls.abortWrites();

        audioBufferCache.set('pcm', makeAudioBuffer([new Float32Array([0.5])]));
        await flushIndexedDbTasks();

        expect(controls.committed.has('pcm')).toBe(false);
        expect(mocks.loggerWarn).toHaveBeenCalledWith(
            '[audioBufferCache] Audio buffer persistence failed',
            expect.objectContaining({ id: 'pcm' })
        );
    });

    // Mutation: removing the `metaStore.put(...)` from updateAccessTimeInIdb
    // reds `expect(...committedMeta...lastAccessed).toBe(70_000)` — the
    // age-based garbage collector would then delete buffers of an open project.
    it('commits a refreshed access time when a cached buffer is read', async () => {
        const audioBufferCache = await importCache();
        const now = vi.spyOn(Date, 'now');
        now.mockReturnValue(1_000);

        audioBufferCache.set('pcm', makeAudioBuffer([new Float32Array([0.5])]));
        await flushIndexedDbTasks();
        expect(controls.committedMeta.get('pcm')?.lastAccessed).toBe(1_000);

        // Past the 60 s coalescing window the persist seeded, so this read is
        // the one that has to reach the store.
        now.mockReturnValue(70_000);
        expect(audioBufferCache.get('pcm')).not.toBeUndefined();
        await flushIndexedDbTasks();

        // The stamp moved on the metadata row and the record was left alone —
        // the whole point of DB_VERSION 2.
        expect(controls.committedMeta.get('pcm')?.lastAccessed).toBe(70_000);
        expect(controls.committed.get('pcm')?.lastAccessed).toBe(1_000);
        expect(mocks.loggerWarn).not.toHaveBeenCalled();
    });

    // Mutation: moving the `store.put` back inside `req.onsuccess` and dropping
    // the transaction await reds `expect(mocks.loggerWarn).toHaveBeenCalledWith(…)`.
    it('reports an access-time refresh whose transaction aborts', async () => {
        const audioBufferCache = await importCache();
        controls.committed.set('pcm', storedRecord([new Float32Array([0.5])], 1_000));
        // An already-migrated record: the row exists at 1 000, so the refresh
        // has a stamp to move and the absence of movement below is the abort
        // rather than a refresh that never ran.
        controls.committedMeta.set('pcm', { lastAccessed: 1_000, sizeInBytes: 4 });
        const context = { createBuffer: () => makeAudioBuffer([new Float32Array(1)]) };
        await audioBufferCache.restoreFromIdb({ context });
        controls.abortWrites();
        mocks.loggerWarn.mockClear();

        expect(audioBufferCache.get('pcm')).not.toBeUndefined();
        await flushIndexedDbTasks();

        // The refresh had a row to write and the abort rolled it back, so the
        // absence below is the abort rather than a refresh that never ran.
        expect(controls.committedMeta.get('pcm')?.lastAccessed).toBe(1_000);
        expect(controls.committed.get('pcm')?.lastAccessed).toBe(1_000);
        expect(mocks.loggerWarn).toHaveBeenCalledWith(
            '[audioBufferCache] Audio buffer access-time refresh failed',
            expect.objectContaining({ id: 'pcm' })
        );
    });

    // Mutation: moving the deletes back inside `req.onsuccess` and returning
    // without awaiting the transaction reds `expect([...committed.keys()])` —
    // the caller is told the collection finished before a single delete is
    // even issued.
    it('resolves the freeze-file collection only once the deletes have committed', async () => {
        const audioBufferCache = await importCache();
        controls.committed.set('freeze-active', storedRecord([new Float32Array([0.1])], 1_000));
        controls.committed.set('freeze-stale', storedRecord([new Float32Array([0.2])], 1_000));
        controls.committed.set('audio-1', storedRecord([new Float32Array([0.3])], 1_000));

        await audioBufferCache.garbageCollectFreezeFiles(new Set(['freeze-active']));

        expect([...controls.committed.keys()].sort()).toEqual(['audio-1', 'freeze-active']);
        expect(mocks.loggerWarn).not.toHaveBeenCalled();
    });

    // Mutation: removing the `onabort` rejection from the freeze collection reds
    // `expect(mocks.loggerWarn).toHaveBeenCalledWith(…)`.
    it('reports a freeze-file collection whose transaction aborts', async () => {
        const audioBufferCache = await importCache();
        controls.committed.set('freeze-stale', storedRecord([new Float32Array([0.2])], 1_000));
        controls.abortWrites();

        await audioBufferCache.garbageCollectFreezeFiles(new Set());

        expect(controls.committed.has('freeze-stale')).toBe(true);
        expect(mocks.loggerWarn).toHaveBeenCalledWith(
            '[audioBufferCache] Freeze-file collection failed',
            expect.any(Object)
        );
    });

    // Mutation: returning `deletedCount` before awaiting the transaction reds
    // `expect(deleted).toBe(0)` — the count is reported for deletes that were
    // rolled back. The metadata row is what makes the record a candidate at all
    // from DB_VERSION 2 on, so seeding it is what keeps this measuring the
    // abort rather than the "no row, do not collect" rule.
    it('reports zero collected buffers when the age-based collection aborts', async () => {
        const audioBufferCache = await importCache();
        controls.committed.set('old', storedRecord([new Float32Array([0.2])], 0));
        controls.committedMeta.set('old', { lastAccessed: 0, sizeInBytes: 4 });
        controls.abortWrites();

        const deleted = await audioBufferCache.garbageCollectByAge(1);

        expect(deleted).toBe(0);
        expect(controls.committed.has('old')).toBe(true);
        expect(controls.committedMeta.has('old')).toBe(true);
    });

    // Presence pin for the assertion above: the same call really does collect
    // when the transaction commits.
    it('counts age-collected buffers that committed', async () => {
        const audioBufferCache = await importCache();
        controls.committed.set('old', storedRecord([new Float32Array([0.2])], 0));
        controls.committed.set('fresh', storedRecord([new Float32Array([0.3])], Date.now()));
        controls.committedMeta.set('old', { lastAccessed: 0, sizeInBytes: 4 });
        controls.committedMeta.set('fresh', { lastAccessed: Date.now(), sizeInBytes: 4 });

        const deleted = await audioBufferCache.garbageCollectByAge(1);

        expect(deleted).toBe(1);
        expect([...controls.committed.keys()]).toEqual(['fresh']);
        expect([...controls.committedMeta.keys()]).toEqual(['fresh']);
    });

    // Mutation: returning `deletedCount` before awaiting the transaction reds
    // `expect(deleted).toBe(0)`.
    it('reports zero collected buffers when the size-based collection aborts', async () => {
        const audioBufferCache = await importCache();
        controls.committed.set('bulky', storedRecord([new Float32Array(64)], 1_000));
        controls.committedMeta.set('bulky', { lastAccessed: 1_000, sizeInBytes: 256 });
        controls.abortWrites();

        const deleted = await audioBufferCache.garbageCollectBySize(1);

        expect(deleted).toBe(0);
        expect(controls.committed.has('bulky')).toBe(true);
        expect(controls.committedMeta.has('bulky')).toBe(true);
    });

    // Presence pin for the assertion above.
    it('counts size-collected buffers that committed', async () => {
        const audioBufferCache = await importCache();
        controls.committed.set('bulky', storedRecord([new Float32Array(64)], 1_000));
        controls.committedMeta.set('bulky', { lastAccessed: 1_000, sizeInBytes: 256 });

        const deleted = await audioBufferCache.garbageCollectBySize(1);

        expect(deleted).toBe(1);
        expect([...controls.committed.keys()]).toEqual([]);
        expect([...controls.committedMeta.keys()]).toEqual([]);
    });
});
