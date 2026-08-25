import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    BUFFER_STORE,
    META_STORE,
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

/** One second of 48 kHz stereo: 48 000 frames x 2 channels x 4 bytes. The
 * smallest fixture that makes the difference between "moved a timestamp" and
 * "rewrote the audio" unambiguous at a glance. */
const FRAMES_PER_SECOND = 48_000;
const PCM_BYTES = FRAMES_PER_SECOND * 2 * Float32Array.BYTES_PER_ELEMENT;

/** Any traffic under this is scalars; the PCM payload is 384 000 bytes, so
 * there is no value a full-record read or write could take that lands here. */
const SCALAR_TRAFFIC_CEILING = 4_096;

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

function stereoSecond(): AudioBuffer {
    return makeAudioBuffer([new Float32Array(FRAMES_PER_SECOND), new Float32Array(FRAMES_PER_SECOND)]);
}

function legacyRecord({
    frames,
    channels,
    lastAccessed,
}: {
    frames: number;
    channels: number;
    lastAccessed: number;
}): StoredAudioBuffer {
    const channelData = Array.from({ length: channels }, () => new Float32Array(frames));
    return {
        sampleRate: 48_000,
        numberOfChannels: channels,
        channelData,
        lastAccessed,
        sizeInBytes: channelData.reduce((total, channel) => total + channel.byteLength, 0),
    };
}

async function importCache(): Promise<typeof import('../audioBufferCache').audioBufferCache> {
    const module = await import('../audioBufferCache');
    return module.audioBufferCache;
}

describe('audioBufferCache metadata store', () => {
    let controls: FakeAudioIndexedDbControls;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
        // The v1 schema. Anything beyond `buffers` has to be created by the
        // upgrade handler under test.
        controls = installFakeAudioIndexedDb({ existingStores: [BUFFER_STORE] });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    describe('access-time refresh', () => {
        // Mutation: putting the whole `SerializedBuffer` back on the buffers
        // store inside `updateAccessTimeInIdb` (the v1 behaviour) reds
        // `bytesWritten` at 384 118 against the 4 096 ceiling, and reds the
        // record's own `lastAccessed` by moving it to 70 000.
        it('moves the stamp without rewriting the record', async () => {
            const audioBufferCache = await importCache();
            const now = vi.spyOn(Date, 'now');
            now.mockReturnValue(1_000);

            audioBufferCache.set('pcm', stereoSecond());
            await flushIndexedDbTasks();
            expect(controls.committed.get('pcm')?.channelData[0]?.length).toBe(FRAMES_PER_SECOND);

            controls.resetByteCounters();
            // Past the 60 s coalescing window the persist seeded, so this read
            // is the one that has to reach the store.
            now.mockReturnValue(70_000);
            expect(audioBufferCache.get('pcm')).not.toBeUndefined();
            await flushIndexedDbTasks();

            expect(controls.bytesWritten()).toBeGreaterThan(0);
            expect(controls.bytesWritten()).toBeLessThan(SCALAR_TRAFFIC_CEILING);
            expect(controls.bytesRead()).toBeLessThan(SCALAR_TRAFFIC_CEILING);
            // The stamp moved on the metadata row; the record kept the value it
            // was persisted with. Two different numbers on two different rows,
            // so neither assertion can be satisfied by the other's write.
            expect(controls.committedMeta.get('pcm')?.lastAccessed).toBe(70_000);
            expect(controls.committed.get('pcm')?.lastAccessed).toBe(1_000);
            expect(mocks.loggerWarn).not.toHaveBeenCalled();
        });

        // Mutation: dropping `sizeInBytes` from the metadata row written by
        // `set` reds `sizeInBytes` here at `undefined`, and the size collector
        // silently stops accounting for the buffer.
        it('carries the record size onto the metadata row when a buffer is persisted', async () => {
            const audioBufferCache = await importCache();
            const now = vi.spyOn(Date, 'now');
            now.mockReturnValue(1_000);

            audioBufferCache.set('pcm', stereoSecond());
            await flushIndexedDbTasks();

            expect(controls.committedMeta.get('pcm')).toEqual({ lastAccessed: 1_000, sizeInBytes: PCM_BYTES });
        });
    });

    describe('collectors', () => {
        // Mutation: reading `store.getAll()` on the buffers store instead of the
        // metadata store in `garbageCollectByAge` (the v1 behaviour) reds
        // `bytesRead` at 768 236 against the 4 096 ceiling.
        it('collects by age without materialising any PCM', async () => {
            const audioBufferCache = await importCache();
            const now = vi.spyOn(Date, 'now');
            now.mockReturnValue(10_000_000_000);
            controls.committed.set('stale', legacyRecord({ frames: FRAMES_PER_SECOND, channels: 2, lastAccessed: 0 }));
            controls.committed.set('warm', legacyRecord({ frames: FRAMES_PER_SECOND, channels: 2, lastAccessed: 0 }));
            controls.committedMeta.set('stale', { lastAccessed: 1_000, sizeInBytes: PCM_BYTES });
            controls.committedMeta.set('warm', { lastAccessed: 10_000_000_000, sizeInBytes: PCM_BYTES });
            controls.resetByteCounters();

            const deleted = await audioBufferCache.garbageCollectByAge(1);

            expect(controls.bytesRead()).toBeLessThan(SCALAR_TRAFFIC_CEILING);
            expect(deleted).toBe(1);
            expect([...controls.committed.keys()]).toEqual(['warm']);
            expect([...controls.committedMeta.keys()]).toEqual(['warm']);
        });

        // Mutation: reading `store.getAll()` on the buffers store instead of the
        // metadata store in `garbageCollectBySize` reds `bytesRead` the same way.
        it('collects by size without materialising any PCM', async () => {
            const audioBufferCache = await importCache();
            controls.committed.set('older', legacyRecord({ frames: FRAMES_PER_SECOND, channels: 2, lastAccessed: 0 }));
            controls.committed.set('newer', legacyRecord({ frames: FRAMES_PER_SECOND, channels: 2, lastAccessed: 0 }));
            controls.committedMeta.set('older', { lastAccessed: 1_000, sizeInBytes: PCM_BYTES });
            controls.committedMeta.set('newer', { lastAccessed: 2_000, sizeInBytes: PCM_BYTES });
            controls.resetByteCounters();

            // Room for exactly one of the two.
            const deleted = await audioBufferCache.garbageCollectBySize(PCM_BYTES + 1);

            expect(deleted).toBe(1);
            expect(controls.bytesRead()).toBeLessThan(SCALAR_TRAFFIC_CEILING);
            // The older stamp went first, so the collector read `lastAccessed`
            // from the metadata row rather than taking store order.
            expect([...controls.committed.keys()]).toEqual(['newer']);
            expect([...controls.committedMeta.keys()]).toEqual(['newer']);
        });
    });

    describe('a record with no metadata row', () => {
        // The single most dangerous line in this change. The invariant is
        // "never collect on a stamp we do not have", and this is the case where
        // there is genuinely no stamp anywhere: no row, and a record from
        // before the field existed. The v1 code answered it with the epoch and
        // deleted on the spot.
        // Mutation: restoring the `?? 0` fallback — on the row or on the record
        // in the migration sweep — reds `deleted` at 1 and empties the store.
        it('is not collected by age when neither the row nor the record carries a stamp', async () => {
            const audioBufferCache = await importCache();
            vi.spyOn(Date, 'now').mockReturnValue(9_000_000_000);
            const stampless = legacyRecord({ frames: 3, channels: 1, lastAccessed: 0 });
            // A record written before `lastAccessed` existed. The type says the
            // field is always there; the original `SerializedBuffer` shape —
            // `{sampleRate, numberOfChannels, channelData}` — is what says
            // otherwise.
            delete (stampless as Partial<StoredAudioBuffer>).lastAccessed;
            controls.committed.set('legacy', stampless);

            const deleted = await audioBufferCache.garbageCollectByAge(1);

            expect(deleted).toBe(0);
            expect([...controls.committed.keys()]).toEqual(['legacy']);
            // The clock starts now rather than at the epoch: `Date.now()` is
            // the furthest-future stamp available, so this can only delay the
            // record's collection, never advance it.
            expect(controls.committedMeta.get('legacy')).toEqual({ lastAccessed: 9_000_000_000, sizeInBytes: 12 });
        });

        // The starvation case. A stamp-less record charges the byte budget when
        // it is read, so if the sweep leaves it unmigrated it is re-read on
        // every later pass — burning the budget forever and keeping every
        // record behind it out of the migration, and therefore out of
        // `garbageCollectBySize`'s total. That is the 2 GiB residual this sweep
        // exists to close, reappearing behind three 24 MB records.
        // Mutation: `continue`-ing without the `metaStore.put` on the
        // stamp-less branch reds `committedMeta.has('ordinary')` at false and
        // holds `bytesRead()` at 75 497 832 on the second pass.
        it('retires a stamp-less record so it cannot starve the ones behind it', async () => {
            const audioBufferCache = await importCache();
            vi.spyOn(Date, 'now').mockReturnValue(9_000_000_000);
            const framesFor24Mb = (24 * 1024 * 1024) / (2 * Float32Array.BYTES_PER_ELEMENT);
            for (let index = 0; index < 3; index++) {
                const stampless = legacyRecord({ frames: framesFor24Mb, channels: 2, lastAccessed: 0 });
                delete (stampless as Partial<StoredAudioBuffer>).lastAccessed;
                controls.committed.set(`stampless-${index}`, stampless);
            }
            controls.committed.set('ordinary', legacyRecord({ frames: 3, channels: 1, lastAccessed: 8_999_999_000 }));

            await audioBufferCache.garbageCollectByAge(1);
            controls.resetByteCounters();
            await audioBufferCache.garbageCollectByAge(1);

            // Second pass: the three big records are already migrated, so it
            // reads none of them and reaches the one behind them.
            expect(controls.committedMeta.get('ordinary')).toEqual({
                lastAccessed: 8_999_999_000,
                sizeInBytes: 12,
            });
            expect(controls.bytesRead()).toBeLessThan(SCALAR_TRAFFIC_CEILING);
            expect(controls.committed.size).toBe(4);
        });

        // Presence pin for the assertion above: same threshold, same absent
        // row, the only difference being that the record carries a real stamp.
        // Recovering it is not the same as inventing one, and v1 reaped these.
        // Mutation: dropping the migration sweep from `garbageCollectByAge`
        // reds `deleted` at 0 — the record becomes immortal, which is what the
        // reviewer caught.
        it('is collected by age on the record own stamp when the row is missing', async () => {
            const audioBufferCache = await importCache();
            controls.committed.set('legacy', legacyRecord({ frames: 3, channels: 1, lastAccessed: 0 }));

            const deleted = await audioBufferCache.garbageCollectByAge(1);

            expect(deleted).toBe(1);
            expect([...controls.committed.keys()]).toEqual([]);
            expect(controls.committedMeta.has('legacy')).toBe(false);
        });

        // The other half of the sweep: a record whose real stamp is *inside*
        // the threshold is migrated rather than reaped, and the row it gets
        // carries the record's own two values.
        // Mutation: `lastAccessed: Date.now()` in the sweep's `metaStore.put`
        // reds this at 9 000 000 000 instead of the record's 8 999 999 000.
        it('is migrated rather than reaped when the record own stamp is recent', async () => {
            const audioBufferCache = await importCache();
            vi.spyOn(Date, 'now').mockReturnValue(9_000_000_000);
            // One second old against a one-day threshold.
            controls.committed.set('recent', legacyRecord({ frames: 3, channels: 1, lastAccessed: 8_999_999_000 }));

            const deleted = await audioBufferCache.garbageCollectByAge(1);

            expect(deleted).toBe(0);
            expect(controls.committedMeta.get('recent')).toEqual({
                lastAccessed: 8_999_999_000,
                sizeInBytes: 12,
            });
        });

        // Presence pin: the same threshold and the same ancient stamp, reached
        // through the row rather than the record.
        it('is collected by age once its metadata row exists', async () => {
            const audioBufferCache = await importCache();
            controls.committed.set('legacy', legacyRecord({ frames: 3, channels: 1, lastAccessed: 0 }));
            controls.committedMeta.set('legacy', { lastAccessed: 0, sizeInBytes: 12 });

            const deleted = await audioBufferCache.garbageCollectByAge(1);

            expect(deleted).toBe(1);
            expect([...controls.committed.keys()]).toEqual([]);
            expect([...controls.committedMeta.keys()]).toEqual([]);
        });

        // Needs a second record that *is* over budget, or the guard cannot
        // fail: with one un-migrated record and nothing else, a size collector
        // that defaulted the missing size to 0 would compute a total of 0,
        // find it already under budget, and delete nothing — passing for the
        // wrong reason. The migrated record is what forces the loop to run.
        //
        // Correct: `metaed` alone is the 100-byte total, it is over the 50-byte
        // budget, so it goes and `legacy` is never considered.
        // Mutation: iterating the buffers store's keys and defaulting a missing
        // row's size to 0 makes `legacy` a candidate — and, sorted by stamp, the
        // *first* one. Deleting it frees nothing, so the total never falls and
        // the loop deletes `metaed` too: reds `deleted` at 2 and the surviving
        // keys at `[]`.
        it('is not collected by size, even while the collector is over budget', async () => {
            const audioBufferCache = await importCache();
            controls.committed.set('legacy', legacyRecord({ frames: 3, channels: 1, lastAccessed: 0 }));
            controls.committed.set('metaed', legacyRecord({ frames: 25, channels: 1, lastAccessed: 2_000 }));
            controls.committedMeta.set('metaed', { lastAccessed: 2_000, sizeInBytes: 100 });

            const deleted = await audioBufferCache.garbageCollectBySize(50);

            expect(deleted).toBe(1);
            expect([...controls.committed.keys()]).toEqual(['legacy']);
            expect(controls.committedMeta.has('legacy')).toBe(false);
        });

        // Presence pin for the assertion above: the same record, over the same
        // budget, collected once it has a row.
        it('is collected by size once its metadata row exists', async () => {
            const audioBufferCache = await importCache();
            controls.committed.set('legacy', legacyRecord({ frames: 3, channels: 1, lastAccessed: 0 }));
            controls.committedMeta.set('legacy', { lastAccessed: 0, sizeInBytes: 12 });

            const deleted = await audioBufferCache.garbageCollectBySize(1);

            expect(deleted).toBe(1);
            expect([...controls.committed.keys()]).toEqual([]);
            expect([...controls.committedMeta.keys()]).toEqual([]);
        });
    });

    describe('migration', () => {
        // Mutation: back-filling every record inside `onupgradeneeded` reds
        // `bytesRead` at 384 118 — the stall this migration exists to avoid, on
        // a store the freeze cleanup caps at 2 GiB. The v3 recovery migration
        // does a bounded key scan after upgrade, so scalar traffic is expected.
        it('creates the metadata store without reading legacy PCM', async () => {
            const audioBufferCache = await importCache();
            controls.committed.set('legacy', legacyRecord({ frames: FRAMES_PER_SECOND, channels: 2, lastAccessed: 5 }));

            // `ids: []` resolves without touching the store, so the only IDB
            // work here is the open and its upgrade.
            await audioBufferCache.restoreFromIdb({ context: { createBuffer: () => stereoSecond() }, ids: [] });

            expect(controls.storeNames()).toContain(META_STORE);
            expect(controls.bytesRead()).toBeLessThan(SCALAR_TRAFFIC_CEILING);
            expect(controls.committedMeta.size).toBe(0);
        });

        // Reached by a read rather than by the collector. The two fixture
        // fields are 70 000 and 12, so a guard can tell which one the code
        // read.
        // Mutation: writing `sizeInBytes: 0` into the row `updateAccessTimeInIdb`
        // seeds reds `sizeInBytes` at 12; using the record's `lastAccessed`
        // instead of the clock reds it at 70 000 — a read is a *use*, so this
        // one is the only seeding site that must stamp now.
        it('back-fills a row from the legacy record the first time the stamp is refreshed', async () => {
            const audioBufferCache = await importCache();
            const now = vi.spyOn(Date, 'now');
            now.mockReturnValue(1_000);
            controls.committed.set('legacy', legacyRecord({ frames: 3, channels: 1, lastAccessed: 1_000 }));
            await audioBufferCache.restoreFromIdb({
                context: { createBuffer: () => makeAudioBuffer([new Float32Array(3)]) },
            });
            await flushIndexedDbTasks();
            expect(controls.committedMeta.has('legacy')).toBe(false);

            now.mockReturnValue(70_000);
            expect(audioBufferCache.get('legacy')).not.toBeUndefined();
            await flushIndexedDbTasks();

            expect(controls.committedMeta.get('legacy')).toEqual({ lastAccessed: 70_000, sizeInBytes: 12 });
            expect(mocks.loggerWarn).not.toHaveBeenCalled();
        });

        // The sweep must not read the whole store in one pass. Six records of
        // 24 MB each is 144 MB against a 64 MB budget: three reads take it to
        // 72 MB, and the budget is checked before each read so the third is the
        // one that overshoots. The remaining three are picked up next pass —
        // the store converges instead of stalling on one enormous transaction.
        // Mutation: dropping the `migrationBytes >= LEGACY_MIGRATION_BYTE_BUDGET`
        // break reds the first assertion at 6, and the byte count at 144 MB.
        it('bounds how much PCM one migration pass reads, and converges over passes', async () => {
            const audioBufferCache = await importCache();
            const now = vi.spyOn(Date, 'now');
            now.mockReturnValue(9_000_000_000);
            const framesFor24Mb = (24 * 1024 * 1024) / (2 * Float32Array.BYTES_PER_ELEMENT);
            for (let index = 0; index < 6; index++) {
                controls.committed.set(
                    `legacy-${index}`,
                    legacyRecord({ frames: framesFor24Mb, channels: 2, lastAccessed: 8_999_999_000 })
                );
            }

            await audioBufferCache.garbageCollectByAge(1);
            expect(controls.committedMeta.size).toBe(3);

            await audioBufferCache.garbageCollectByAge(1);
            expect(controls.committedMeta.size).toBe(6);
            // Every record survived: they are recent, so the sweep migrated
            // them rather than reaping them.
            expect(controls.committed.size).toBe(6);
        });
    });

    describe('an open blocked by another connection', () => {
        /** Whether `pending` settled within a generous number of task turns.
         *
         * A hang is the absence of an event, and the only honest way to observe
         * an absence is to give it more turns than the code under test could
         * possibly need and then look. Racing a bounded number of macrotasks
         * says that in about a millisecond; letting the spec time out says the
         * same thing five seconds later, and says it identically for a typo in
         * the fixture. */
        async function settlesWithin<Result>(pending: Promise<Result>): Promise<boolean> {
            const NEVER = Symbol('did-not-settle');
            const exhausted = flushIndexedDbTasks(40).then(() => NEVER);
            const settled = pending.then(
                (value: Result) => value,
                () => NEVER
            );
            const winner = await Promise.race([settled, exhausted]);
            return winner !== NEVER;
        }

        // `blocked` becomes reachable at this bump for the same reason
        // `versionchange` does, and it is the only consequence that hangs
        // rather than degrades: it fires neither `success` nor `error`, and
        // `openDb` memoises the promise, so every later caller joins the same
        // pending one and `dbPromise` is never cleared.
        // Mutation: deleting `req.onblocked` reds `settled` at false — the
        // restore never settles at all, which is the defect.
        it('settles the restore instead of hanging it', async () => {
            vi.unstubAllGlobals();
            controls = installFakeAudioIndexedDb({ existingStores: [BUFFER_STORE], blockOpens: 'forever' });
            const audioBufferCache = await importCache();

            const pending = audioBufferCache.restoreFromIdb({
                context: { createBuffer: () => stereoSecond() },
                ids: ['pcm'],
            });

            expect(await settlesWithin(pending)).toBe(true);
            // Reached the `catch` and published nothing, rather than sitting
            // mid project load.
            expect(await pending).toBe(0);
        });

        // The memo must not keep a rejected open, or one blocked moment would
        // disable persistence for the life of the page. A second call opens a
        // second request rather than joining the first.
        // Mutation: dropping `forgetIfCurrent()` from `openDb`'s catch reds
        // `openRequestCount()` at 1. Both calls go through `settlesWithin`
        // rather than a bare `await`, so removing `onblocked` reds this at the
        // first assertion in milliseconds instead of hanging the spec.
        it('clears the memo so the next caller retries', async () => {
            vi.unstubAllGlobals();
            controls = installFakeAudioIndexedDb({ existingStores: [BUFFER_STORE], blockOpens: 'forever' });
            const audioBufferCache = await importCache();
            const context = { createBuffer: () => stereoSecond() };

            expect(await settlesWithin(audioBufferCache.restoreFromIdb({ context, ids: ['pcm'] }))).toBe(true);
            expect(await settlesWithin(audioBufferCache.restoreFromIdb({ context, ids: ['pcm'] }))).toBe(true);

            expect(controls.openRequestCount()).toBe(2);
        });

        // The blocking context eventually closes and the open completes — but
        // the caller was told it failed and has moved on. Holding that handle
        // would block the very upgrade the rejection yielded to, which is the
        // whole reason the latch exists.
        // Mutation: dropping the `if (settled) { db.close(); return; }` arm from
        // `onsuccess` reds `liveConnectionCount()` at 1 and `closeCount()` at 0.
        it('closes a connection that arrives after the open was reported blocked', async () => {
            vi.unstubAllGlobals();
            controls = installFakeAudioIndexedDb({ existingStores: [BUFFER_STORE], blockOpens: 'then-yields' });
            const audioBufferCache = await importCache();

            await audioBufferCache.restoreFromIdb({
                context: { createBuffer: () => stereoSecond() },
                ids: ['pcm'],
            });
            // Let the blocking context yield and the open complete.
            await flushIndexedDbTasks();

            expect(controls.openRequestCount()).toBe(1);
            expect(controls.closeCount()).toBe(1);
            expect(controls.liveConnectionCount()).toBe(0);
        });
    });

    describe('two-store mutations', () => {
        // Mutation: writing the record and its metadata row in two separate
        // transactions reds the scope assertion, and — with `abortWrites` — reds
        // the roll-back assertion by leaving one store written and the other not.
        it('persist a record and its metadata row under one transaction', async () => {
            const audioBufferCache = await importCache();

            audioBufferCache.set('pcm', makeAudioBuffer([new Float32Array([0.5])]));
            await flushIndexedDbTasks();

            const writeScopes = controls.transactionScopes().filter((scope) => scope.includes(BUFFER_STORE));
            expect(writeScopes.at(-1)).toEqual([BUFFER_STORE, META_STORE]);
        });

        // Fails the record store only, which is what a quota error looks like.
        // Under one transaction the metadata row goes with it. Under two, the
        // metadata write has already committed — the size collector then
        // accounts for audio that is not in the store.
        // Mutation: splitting the persist into two transactions reds
        // `committedMeta.has('pcm')` at `true`. A blanket `abortWrites()` here
        // could not see that: it kills both halves and the stores agree by
        // accident.
        it('roll back together, so size accounting cannot drift from the records', async () => {
            const audioBufferCache = await importCache();
            controls.abortWritesTo(BUFFER_STORE);
            const id = 'freeze-pending-owner';

            audioBufferCache.set(id, stereoSecond(), { freezeProjectId: 200 });
            await flushIndexedDbTasks();

            expect(controls.committed.has(id)).toBe(false);
            expect(controls.committedMeta.has(id)).toBe(false);
            expect((await audioBufferCache.exportBuffers([id]))[id]?.freezeProjectId).toBe(200);
            controls.allowWrites();
            await audioBufferCache.garbageCollectFreezeFiles({ activeIds: new Set(), projectId: 200 });
            expect(audioBufferCache.has(id)).toBe(false);
            expect(mocks.loggerWarn).toHaveBeenCalledWith(
                '[audioBufferCache] Audio buffer persistence failed',
                expect.objectContaining({ id })
            );
        });

        // Mutation: dropping the metadata delete from `remove` reds
        // `committedMeta.has('pcm')` — an orphan row would keep the size
        // collector counting bytes that no longer exist.
        it('remove a record and its metadata row together', async () => {
            const audioBufferCache = await importCache();
            audioBufferCache.set('pcm', makeAudioBuffer([new Float32Array([0.5])]));
            await flushIndexedDbTasks();
            expect(controls.committedMeta.has('pcm')).toBe(true);

            audioBufferCache.remove('pcm');
            await flushIndexedDbTasks();

            expect(controls.committed.has('pcm')).toBe(false);
            expect(controls.committedMeta.has('pcm')).toBe(false);
        });

        // Mutation: dropping the metadata delete from `garbageCollectFreezeFiles`
        // reds `committedMeta` — the stale freeze row survives its record.
        it('collect a freeze record and its metadata row together', async () => {
            const audioBufferCache = await importCache();
            controls.committed.set('freeze-stale', legacyRecord({ frames: 3, channels: 1, lastAccessed: 1_000 }));
            controls.committed.set('freeze-live', legacyRecord({ frames: 3, channels: 1, lastAccessed: 1_000 }));
            controls.committedMeta.set('freeze-stale', { freezeProjectId: 200, lastAccessed: 1_000, sizeInBytes: 12 });
            controls.committedMeta.set('freeze-live', { freezeProjectId: 200, lastAccessed: 1_000, sizeInBytes: 12 });

            await audioBufferCache.garbageCollectFreezeFiles({ activeIds: new Set(['freeze-live']), projectId: 200 });

            expect([...controls.committed.keys()]).toEqual(['freeze-live']);
            expect([...controls.committedMeta.keys()]).toEqual(['freeze-live']);
        });

        it('protects every prepared owner classification across durable and resident freeze scans', async () => {
            const audioBufferCache = await importCache();
            const invalidOwnerId = 'freeze-invalid-prepared-owner';
            const reconcilingOwnerId = 'freeze-reconciling-prepared-owner';
            const ordinaryId = 'freeze-ordinary-stale';
            for (const id of [invalidOwnerId, reconcilingOwnerId, ordinaryId]) {
                audioBufferCache.set(id, makeAudioBuffer([new Float32Array([0.5])]), { freezeProjectId: 200 });
            }
            await flushIndexedDbTasks();
            controls.committedMeta.get(invalidOwnerId)!.preparedOwner = {
                schemaVersion: 1,
                leaseId: '',
                status: 'project-owned',
            };
            controls.committedMeta.get(reconcilingOwnerId)!.preparedOwner = {
                schemaVersion: 1,
                leaseId: 'reconciling-lease',
                promotionRevision: 'promotion-revision',
                status: 'project-owned',
            };

            await audioBufferCache.garbageCollectFreezeFiles({ activeIds: new Set(), projectId: 200 });

            expect(controls.committed.has(invalidOwnerId)).toBe(true);
            expect(controls.committed.has(reconcilingOwnerId)).toBe(true);
            expect(audioBufferCache.has(invalidOwnerId)).toBe(true);
            expect(audioBufferCache.has(reconcilingOwnerId)).toBe(true);
            expect(controls.committed.has(ordinaryId)).toBe(false);
            expect(audioBufferCache.has(ordinaryId)).toBe(false);
        });

        // Mutation: dropping the metadata clear from `clear()` reds
        // `committedMeta.size` — every row of the previous project would keep
        // counting against the 2 GiB cap.
        it('clear both stores together', async () => {
            const audioBufferCache = await importCache();
            audioBufferCache.set('pcm', makeAudioBuffer([new Float32Array([0.5])]));
            await flushIndexedDbTasks();

            audioBufferCache.clear();
            await flushIndexedDbTasks();

            expect(controls.committed.size).toBe(0);
            expect(controls.committedMeta.size).toBe(0);
        });

        it('clears resident project audio without deleting either project from IndexedDB', async () => {
            const { audioBufferCache, clearRuntimeAudioBufferCache } = await import('../audioBufferCache');
            const projectAId = 'freeze-project-100-track-a';
            const projectBId = 'freeze-project-200-track-b';
            audioBufferCache.set(projectAId, makeAudioBuffer([new Float32Array([0.1])]), {
                freezeProjectId: 100,
            });
            audioBufferCache.set(projectBId, makeAudioBuffer([new Float32Array([0.2])]), {
                freezeProjectId: 200,
            });
            await flushIndexedDbTasks();

            clearRuntimeAudioBufferCache();

            expect(audioBufferCache.has(projectAId)).toBe(false);
            expect(audioBufferCache.has(projectBId)).toBe(false);
            expect([...controls.committed.keys()].sort()).toEqual([projectAId, projectBId]);
            expect(controls.committedMeta.get(projectAId)?.freezeProjectId).toBe(100);
            expect(controls.committedMeta.get(projectBId)?.freezeProjectId).toBe(200);
        });
    });
});
