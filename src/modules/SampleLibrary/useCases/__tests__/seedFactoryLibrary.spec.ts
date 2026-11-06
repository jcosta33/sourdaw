import { describe, it, expect, vi, beforeEach } from 'vitest';

// MUST mirror MAX_AUDIO_BUFFER_ENTRIES in
// src/modules/AudioEngine/stores/audioBufferCache.ts. The seed path inserts
// one buffer per factory sample, and the factory pack generates more samples
// than this cap — so seeding necessarily drives the LRU eviction. A plain
// vi.fn() mock for `set` would hide that: it would record every call but never
// evict, so a data-retention regression in the cache (or a sample-count blowup)
// would pass silently. We instead inject a faithful LRU cache below.
const MAX_AUDIO_BUFFER_ENTRIES = 64;

/** Minimal re-implementation of the audioBufferCache LRU eviction policy:
 * insertion-order Map as the LRU proxy, promote-on-reinsert, evict the oldest
 * key once the cap is exceeded. Mirrors audioCacheSet() so the seed path is
 * exercised against real eviction semantics rather than an unbounded spy. */
function createLruCacheFixture() {
    const cache = new Map<string, AudioBuffer>();
    const evicted: string[] = [];
    return {
        cache,
        evicted,
        set: vi.fn((id: string, buffer: AudioBuffer) => {
            if (cache.has(id)) {
                cache.delete(id);
            } else if (cache.size >= MAX_AUDIO_BUFFER_ENTRIES) {
                const lruKey = cache.keys().next().value;
                if (lruKey !== undefined) {
                    cache.delete(lruKey);
                    evicted.push(lruKey);
                }
            }
            cache.set(id, buffer);
        }),
    };
}

const lru = createLruCacheFixture();
// Ids the AudioEngine store holds PCM for, from this launch or an earlier one.
const storedIds = new Set<string>();

type TestRoot = { id: string; status?: string; fileCount?: number };

const mocks = vi.hoisted(() => {
    const libraryStoreValue: { value: { roots: TestRoot[]; samples: unknown[]; activeRootId?: string } } = {
        value: { roots: [], samples: [] },
    };
    return {
        libraryStoreValue,
        // Stateful like the real writers, so a case reads roots and their
        // status from the store rather than from the order of spy calls.
        addLibraryRoot: vi.fn((root: TestRoot) => {
            const state = libraryStoreValue.value;
            if (!state.roots.some((existing) => existing.id === root.id)) {
                libraryStoreValue.value = { ...state, roots: [...state.roots, root] };
            }
        }),
        addSamples: vi.fn(),
        updateLibraryRootStatus: vi.fn((rootId: string, status: string, fileCount?: number) => {
            const state = libraryStoreValue.value;
            libraryStoreValue.value = {
                ...state,
                roots: state.roots.map((root) =>
                    root.id === rootId ? { ...root, status, fileCount: fileCount ?? root.fileCount } : root
                ),
            };
        }),
        persistLibraryRoots: vi.fn(async () => {}),
        persistSamples: vi.fn(async () => {}),
        buildFolderTree: vi.fn(),
    };
});

vi.mock('../../stores/libraryStore', () => ({
    libraryStore: {
        get value() {
            return mocks.libraryStoreValue.value;
        },
    },
    addLibraryRoot: mocks.addLibraryRoot,
    addSamples: mocks.addSamples,
    updateLibraryRootStatus: mocks.updateLibraryRootStatus,
}));

vi.mock('../../repositories/libraryPersistence/persistLibraryRoots', () => ({
    persistLibraryRoots: mocks.persistLibraryRoots,
}));

vi.mock('../../repositories/libraryPersistence/persistSamples', () => ({
    persistSamples: mocks.persistSamples,
}));

// The seed routes buffer registration through the AudioEngine-owned
// cacheAudioBuffer use case (not the raw audioBufferCache). The mock delegates
// to the faithful LRU fixture above so eviction semantics stay under test, while
// the spy proves the seed calls the use-case contract — a { buffer, bufferId }
// object — rather than the raw positional cache.
vi.mock('#/modules/AudioEngine/useCases', () => ({
    cacheAudioBuffer: vi.fn(({ buffer, bufferId }: { buffer: AudioBuffer; bufferId?: string }): string => {
        const id = bufferId ?? `generated-${crypto.randomUUID()}`;
        lru.set(id, buffer);
        return id;
    }),
    getCachedAudioBuffer: vi.fn(({ bufferId }: { bufferId: string }) => lru.cache.get(bufferId) ?? null),
    restoreUnpinnedAudioBuffersFromIdb: vi.fn(async ({ bufferIds }: { bufferIds: readonly string[] }) => ({
        absentIds: bufferIds.filter((id) => !storedIds.has(id) && !lru.cache.has(id)),
        release: () => undefined,
    })),
}));

vi.mock('../buildFolderTree', () => ({
    buildFolderTree: mocks.buildFolderTree,
}));

// Synthesis runs in a Worker behind this use case; the seed only consumes the
// samples it resolves, so the spec controls them directly.
vi.mock('#/modules/FactorySynthesis/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/FactorySynthesis/useCases')>()),
    renderFactorySamples: vi.fn(),
}));

import { cacheAudioBuffer } from '#/modules/AudioEngine/useCases';
import { FACTORY_SEED_FLAG_KEY, renderFactorySamples } from '#/modules/FactorySynthesis/useCases';

import { rescanFactoryLibrary } from '../factoryLibrary/rescanFactoryLibrary';
import { seedFactoryLibrary } from '../seedFactoryLibrary';

type RenderedSample = Awaited<ReturnType<typeof renderFactorySamples>>[number];

// More samples than the buffer cache holds, so seeding drives eviction.
const RENDERED_SAMPLE_COUNT = 70;

function createRenderedSample(index: number): RenderedSample {
    const length = 4410 + index;
    const channels = index % 2 === 0 ? 1 : 2;
    const buffer = { length, numberOfChannels: channels, sampleRate: 44100, duration: length / 44100 };
    return {
        id: `factory-test-pack-${index}`,
        name: `Test Sample ${index}`,
        category: index % 2 === 0 ? 'drums' : 'fx',
        tags: ['test'],
        buffer: buffer as unknown as AudioBuffer,
    };
}

function createRenderedSamples(): RenderedSample[] {
    return Array.from({ length: RENDERED_SAMPLE_COUNT }, (_, index) => createRenderedSample(index));
}

const ctx = {} as AudioContext;

describe('seedFactoryLibrary', () => {
    let rendered: RenderedSample[];

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.libraryStoreValue.value = { roots: [], samples: [] };
        localStorage.removeItem(FACTORY_SEED_FLAG_KEY);
        lru.cache.clear();
        lru.evicted.length = 0;
        storedIds.clear();
        rendered = createRenderedSamples();
        vi.mocked(renderFactorySamples).mockResolvedValue(rendered);
    });

    it('seeds all factory content on first launch', async () => {
        await seedFactoryLibrary(ctx);

        expect(renderFactorySamples).toHaveBeenCalledExactlyOnceWith(ctx);
        expect(mocks.addLibraryRoot).toHaveBeenCalledTimes(1);
        expect(cacheAudioBuffer).toHaveBeenCalledTimes(RENDERED_SAMPLE_COUNT);
        expect(mocks.addSamples).toHaveBeenCalledTimes(1);
        expect(mocks.buildFolderTree).toHaveBeenCalledWith('factory');
        expect(mocks.persistLibraryRoots).toHaveBeenCalledTimes(1);
        expect(mocks.persistSamples).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem(FACTORY_SEED_FLAG_KEY)).not.toBeNull();
    });

    it('caches each rendered buffer under the id its SampleRecord carries', async () => {
        await seedFactoryLibrary(ctx);

        // Buffer cache keys must line up exactly with the rendered sample ids,
        // otherwise lookups from the persisted SampleRecords would miss. Each
        // buffer goes through the AudioEngine-owned use case with the
        // { buffer, bufferId } contract rather than the raw positional cache.
        const cached = vi.mocked(cacheAudioBuffer).mock.calls.map(([call]) => call);
        expect(cached).toEqual(rendered.map((sample) => ({ buffer: sample.buffer, bufferId: sample.id })));

        const records: { id: string }[] = mocks.addSamples.mock.calls[0]![0];
        expect(records.map((record) => record.id)).toEqual(rendered.map((sample) => sample.id));
    });

    it('records each sample format from its rendered buffer', async () => {
        await seedFactoryLibrary(ctx);

        const records: { id: string; format: unknown; sync: { sizeBytes: number } }[] =
            mocks.addSamples.mock.calls[0]![0];
        const stereo = rendered[1]!;
        const record = records.find((candidate) => candidate.id === stereo.id)!;
        expect(record.format).toEqual({
            durationSec: stereo.buffer.duration,
            sampleRate: 44100,
            channels: 2,
            bitDepth: 32,
        });
        expect(record.sync.sizeBytes).toBe(stereo.buffer.length * 2 * 4);
    });

    it('respects MAX_AUDIO_BUFFER_ENTRIES — the LRU cache evicts the oldest factory buffers it cannot hold in memory', async () => {
        const renderedIds = rendered.map((sample) => sample.id);
        expect(renderedIds.length).toBeGreaterThan(MAX_AUDIO_BUFFER_ENTRIES);

        await seedFactoryLibrary(ctx);

        expect(lru.cache.size).toBe(MAX_AUDIO_BUFFER_ENTRIES);
        const overflow = renderedIds.length - MAX_AUDIO_BUFFER_ENTRIES;
        expect(lru.evicted).toEqual(renderedIds.slice(0, overflow));
        expect([...lru.cache.keys()]).toEqual(renderedIds.slice(overflow));
    });

    it('focuses the factory root only when no other root is focused', async () => {
        await seedFactoryLibrary(ctx);
        expect(mocks.addLibraryRoot).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'factory' }), {
            activate: true,
        });

        localStorage.removeItem(FACTORY_SEED_FLAG_KEY);
        mocks.libraryStoreValue.value = { roots: [], samples: [], activeRootId: 'restored-root' };
        await seedFactoryLibrary(ctx);
        expect(mocks.addLibraryRoot).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'factory' }), {
            activate: false,
        });
    });

    it('rejects and leaves the seed flag unset when synthesis fails, so the next launch retries', async () => {
        const renderError = new Error('Factory sample synthesis failed in its worker (render-timed-out)');
        vi.mocked(renderFactorySamples).mockRejectedValueOnce(renderError);

        await expect(seedFactoryLibrary(ctx)).rejects.toBe(renderError);

        expect(localStorage.getItem(FACTORY_SEED_FLAG_KEY)).toBeNull();
        expect(mocks.addLibraryRoot).not.toHaveBeenCalled();
        expect(cacheAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.addSamples).not.toHaveBeenCalled();
        expect(mocks.persistLibraryRoots).not.toHaveBeenCalled();
        expect(mocks.persistSamples).not.toHaveBeenCalled();
    });

    it('propagates a persistence quota failure and leaves the seed flag unset so a retry can re-seed', async () => {
        const quotaError = new DOMException('Quota exceeded', 'QuotaExceededError');
        mocks.persistSamples.mockRejectedValueOnce(quotaError);

        // persistSamples is awaited before the seed flag is written. A quota
        // rejection must surface to the caller (not be swallowed) AND must leave
        // the flag unset — otherwise a half-seeded library would be marked
        // "seeded" and never repaired on the next launch.
        await expect(seedFactoryLibrary(ctx)).rejects.toBe(quotaError);

        expect(localStorage.getItem(FACTORY_SEED_FLAG_KEY)).toBeNull();
        // The in-memory work up to the failed persist still happened.
        expect(mocks.addSamples).toHaveBeenCalledTimes(1);
        expect(cacheAudioBuffer).toHaveBeenCalledTimes(RENDERED_SAMPLE_COUNT);
    });

    it('lists and persists nothing, and leaves the seed to retry, when the root is disconnected mid-cache', async () => {
        vi.mocked(renderFactorySamples).mockImplementationOnce(async () => {
            // Runs during the yield after the first chunk is cached.
            setTimeout(() => {
                mocks.libraryStoreValue.value = { roots: [], samples: [] };
            }, 0);
            return rendered;
        });

        await seedFactoryLibrary(ctx);

        expect(mocks.addSamples).not.toHaveBeenCalled();
        expect(mocks.buildFolderTree).not.toHaveBeenCalled();
        expect(mocks.persistLibraryRoots).not.toHaveBeenCalled();
        expect(mocks.persistSamples).not.toHaveBeenCalled();
        expect(localStorage.getItem(FACTORY_SEED_FLAG_KEY)).toBeNull();
    });

    it('does not resurrect a factory root the user disconnected after the first seed', async () => {
        // The flag says the library was seeded once; the restored store has no
        // factory root, so the user removed it on purpose.
        localStorage.setItem(FACTORY_SEED_FLAG_KEY, '1');
        await seedFactoryLibrary(ctx);

        expect(renderFactorySamples).not.toHaveBeenCalled();
        expect(mocks.addLibraryRoot).not.toHaveBeenCalled();
        expect(mocks.addSamples).not.toHaveBeenCalled();
        expect(mocks.updateLibraryRootStatus).not.toHaveBeenCalled();
        expect(cacheAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.persistSamples).not.toHaveBeenCalled();
    });

    it('does not re-add the factory root if one already exists', async () => {
        mocks.libraryStoreValue.value = { roots: [{ id: 'factory', status: 'offline', fileCount: 0 }], samples: [] };

        await seedFactoryLibrary(ctx);

        expect(mocks.addLibraryRoot).not.toHaveBeenCalled();
        expect(mocks.addSamples).toHaveBeenCalledTimes(1);
        expect(mocks.libraryStoreValue.value.roots[0]).toMatchObject({
            status: 'ready',
            fileCount: RENDERED_SAMPLE_COUNT,
        });
    });

    describe('with the factory root restored from storage after a relaunch', () => {
        beforeEach(() => {
            // restoreLibrary brings the handle-less factory root back offline,
            // and no buffer survives the previous session in memory.
            localStorage.setItem(FACTORY_SEED_FLAG_KEY, '1');
            mocks.libraryStoreValue.value = {
                roots: [{ id: 'factory', status: 'offline', fileCount: 0 }],
                samples: rendered.map((sample) => ({ id: sample.id, libraryRootId: 'factory' })),
            };
        });

        it('renders nothing at launch and marks the root ready with its record count', async () => {
            mocks.libraryStoreValue.value = {
                ...mocks.libraryStoreValue.value,
                samples: [
                    ...mocks.libraryStoreValue.value.samples,
                    { id: 'user-loop', libraryRootId: 'connected-root' },
                ],
            };

            await seedFactoryLibrary(ctx);

            expect(renderFactorySamples).not.toHaveBeenCalled();
            expect(cacheAudioBuffer).not.toHaveBeenCalled();
            expect(mocks.libraryStoreValue.value.roots[0]).toMatchObject({
                status: 'ready',
                fileCount: RENDERED_SAMPLE_COUNT,
            });
        });

        it('keeps the persisted root and records as they are', async () => {
            await seedFactoryLibrary(ctx);

            expect(mocks.addLibraryRoot).not.toHaveBeenCalled();
            expect(mocks.addSamples).not.toHaveBeenCalled();
            expect(mocks.buildFolderTree).not.toHaveBeenCalled();
            expect(mocks.persistLibraryRoots).not.toHaveBeenCalled();
            expect(mocks.persistSamples).not.toHaveBeenCalled();
        });

        describe('a rescan of the factory root', () => {
            it('re-renders and re-caches every factory buffer under its sample id, then marks the root ready', async () => {
                let statusWhileRendering: string | undefined;
                vi.mocked(renderFactorySamples).mockImplementationOnce(async () => {
                    statusWhileRendering = mocks.libraryStoreValue.value.roots[0]?.status;
                    return rendered;
                });

                await rescanFactoryLibrary(ctx);

                expect(renderFactorySamples).toHaveBeenCalledExactlyOnceWith(ctx);
                expect(statusWhileRendering).toBe('scanning');
                const cached = vi.mocked(cacheAudioBuffer).mock.calls.map(([call]) => call);
                expect(cached).toEqual(rendered.map((sample) => ({ buffer: sample.buffer, bufferId: sample.id })));
                expect(mocks.libraryStoreValue.value.roots[0]).toMatchObject({
                    status: 'ready',
                    fileCount: RENDERED_SAMPLE_COUNT,
                });
                expect(mocks.persistSamples).not.toHaveBeenCalled();
            });

            it('lists a factory sample the stored library lacks, such as one a later release added', async () => {
                const added = rendered.at(-1)!;
                mocks.libraryStoreValue.value = {
                    ...mocks.libraryStoreValue.value,
                    samples: rendered.slice(0, -1).map((sample) => ({ id: sample.id, libraryRootId: 'factory' })),
                };

                await rescanFactoryLibrary(ctx);

                const records: { id: string }[] = mocks.addSamples.mock.calls[0]![0];
                expect(records.map((record) => record.id)).toEqual([added.id]);
                expect(mocks.buildFolderTree).toHaveBeenCalledWith('factory');
            });

            it('leaves the root offline, not scanning, when the render fails', async () => {
                const renderError = new Error('Factory sample synthesis failed in its worker (render-timed-out)');
                vi.mocked(renderFactorySamples).mockRejectedValueOnce(renderError);

                await expect(rescanFactoryLibrary(ctx)).rejects.toBe(renderError);

                expect(mocks.libraryStoreValue.value.roots[0]?.status).toBe('offline');
                expect(cacheAudioBuffer).not.toHaveBeenCalled();
            });

            it('caches nothing when the user disconnects the root while it renders', async () => {
                vi.mocked(renderFactorySamples).mockImplementationOnce(async () => {
                    mocks.libraryStoreValue.value = { roots: [], samples: [] };
                    return rendered;
                });

                await rescanFactoryLibrary(ctx);

                expect(cacheAudioBuffer).not.toHaveBeenCalled();
                expect(mocks.addSamples).not.toHaveBeenCalled();
                expect(mocks.libraryStoreValue.value.roots).toEqual([]);
            });

            it('leaves the audio of a sample with stored PCM as it is', async () => {
                // A saved project may play this stored take; a render of
                // another build can differ from it.
                const savedTake = rendered[5]!.id;
                storedIds.add(savedTake);

                await rescanFactoryLibrary(ctx);

                const cachedIds = vi.mocked(cacheAudioBuffer).mock.calls.map(([call]) => call.bufferId);
                expect(cachedIds).not.toContain(savedTake);
                expect(cachedIds).toHaveLength(RENDERED_SAMPLE_COUNT - 1);
            });

            it('never replaces a resident buffer with its re-rendered copy', async () => {
                // An open project may hold this buffer pinned. A pack the
                // cache can hold whole, so the fixture evicts nothing.
                const pack = rendered.slice(0, 20);
                vi.mocked(renderFactorySamples).mockResolvedValueOnce(pack);
                const resident = { id: 'resident', source: 'project' } as unknown as AudioBuffer;
                const residentId = pack.at(-1)!.id;
                lru.cache.set(residentId, resident);

                await rescanFactoryLibrary(ctx);

                expect(lru.cache.get(residentId)).toBe(resident);
                const cachedIds = vi.mocked(cacheAudioBuffer).mock.calls.map(([call]) => call.bufferId);
                expect(cachedIds).not.toContain(residentId);
            });

            it('caches no further buffers and lists no records once the root is disconnected mid-cache', async () => {
                const CACHE_CHUNK = 16;
                vi.mocked(renderFactorySamples).mockImplementationOnce(async () => {
                    // Runs during the yield after the first chunk is cached.
                    setTimeout(() => {
                        mocks.libraryStoreValue.value = { roots: [], samples: [] };
                    }, 0);
                    return rendered;
                });

                await rescanFactoryLibrary(ctx);

                expect(cacheAudioBuffer).toHaveBeenCalledTimes(CACHE_CHUNK);
                expect(mocks.libraryStoreValue.value).toEqual({ roots: [], samples: [] });
                expect(mocks.buildFolderTree).not.toHaveBeenCalled();
            });

            it('shares one render between overlapping requests', async () => {
                await Promise.all([rescanFactoryLibrary(ctx), rescanFactoryLibrary(ctx)]);

                expect(renderFactorySamples).toHaveBeenCalledTimes(1);
                expect(cacheAudioBuffer).toHaveBeenCalledTimes(RENDERED_SAMPLE_COUNT);
            });
        });
    });
});
