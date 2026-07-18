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

const mocks = vi.hoisted(() => ({
    libraryStoreValue: { value: { roots: [], samples: [] } },
    addLibraryRoot: vi.fn(),
    addSamples: vi.fn(),
    persistLibraryRoots: vi.fn(async () => {}),
    persistSamples: vi.fn(async () => {}),
    buildFolderTree: vi.fn(),
}));

vi.mock('../../stores/libraryStore', () => ({
    libraryStore: {
        get value() {
            return mocks.libraryStoreValue.value;
        },
    },
    addLibraryRoot: mocks.addLibraryRoot,
    addSamples: mocks.addSamples,
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
}));

vi.mock('../buildFolderTree', () => ({
    buildFolderTree: mocks.buildFolderTree,
}));

import { cacheAudioBuffer } from '#/modules/AudioEngine/useCases';
import { FACTORY_SEED_FLAG_KEY, generateFactorySamples } from '#/modules/FactorySynthesis/useCases';

import { seedFactoryLibrary } from '../seedFactoryLibrary';

type MutableBuffer = {
    numberOfChannels: number;
    length: number;
    sampleRate: number;
    duration: number;
    channels: Float32Array[];
    getChannelData: (idx: number) => Float32Array;
};

function createMockAudioContext(): AudioContext {
    return {
        createBuffer: (channels: number, length: number, sampleRate: number): MutableBuffer => {
            const chans: Float32Array[] = Array.from({ length: channels }, () => new Float32Array(length));
            return {
                numberOfChannels: channels,
                length,
                sampleRate,
                duration: length / sampleRate,
                channels: chans,
                getChannelData: (idx: number) => chans[idx]!,
            };
        },
    } as unknown as AudioContext;
}

describe('seedFactoryLibrary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.libraryStoreValue.value = { roots: [], samples: [] };
        localStorage.removeItem(FACTORY_SEED_FLAG_KEY);
        lru.cache.clear();
        lru.evicted.length = 0;
    });

    it('seeds all factory content on first launch', async () => {
        const ctx = createMockAudioContext();
        await seedFactoryLibrary(ctx);

        expect(mocks.addLibraryRoot).toHaveBeenCalledTimes(1);
        expect(vi.mocked(cacheAudioBuffer).mock.calls.length).toBeGreaterThanOrEqual(60);
        expect(mocks.addSamples).toHaveBeenCalledTimes(1);
        expect(mocks.buildFolderTree).toHaveBeenCalledWith('factory');
        expect(localStorage.getItem(FACTORY_SEED_FLAG_KEY)).not.toBeNull();
    });

    it('inserts one cache buffer per generated factory sample', async () => {
        const ctx = createMockAudioContext();
        const sampleCount = generateFactorySamples(ctx).length;

        await seedFactoryLibrary(ctx);

        // The seed must attempt to cache every sample it generated — no fewer,
        // no silent drops before reaching the cache — and it must route each
        // buffer through the AudioEngine-owned use case, called with the
        // { buffer, bufferId } contract rather than the raw positional cache.
        expect(cacheAudioBuffer).toHaveBeenCalledTimes(sampleCount);
        expect(cacheAudioBuffer).toHaveBeenCalledWith(expect.objectContaining({ bufferId: expect.any(String) }));
    });

    it('caches each sample under the same id that its SampleRecord carries', async () => {
        const ctx = createMockAudioContext();
        const generatedIds = generateFactorySamples(ctx).map((s) => s.id);

        await seedFactoryLibrary(ctx);

        const cachedIds = vi.mocked(cacheAudioBuffer).mock.calls.map(([{ bufferId }]) => bufferId);
        // Buffer cache keys must line up exactly with the generated sample ids,
        // otherwise lookups from the persisted SampleRecords would miss.
        expect(new Set(cachedIds)).toEqual(new Set(generatedIds));
    });

    it('respects MAX_AUDIO_BUFFER_ENTRIES — the LRU cache evicts the oldest factory buffers it cannot hold in memory', async () => {
        const ctx = createMockAudioContext();
        const generatedIds = generateFactorySamples(ctx).map((s) => s.id);

        // Precondition for this regression to be meaningful: the pack must
        // generate more buffers than the cache can hold. If it ever shrinks
        // below the cap, this test should be revisited rather than silently pass.
        expect(generatedIds.length).toBeGreaterThan(MAX_AUDIO_BUFFER_ENTRIES);

        await seedFactoryLibrary(ctx);

        // The in-memory cache is bounded: it can never exceed the cap, even
        // though the seed inserted more buffers than that.
        expect(lru.cache.size).toBe(MAX_AUDIO_BUFFER_ENTRIES);

        const overflow = generatedIds.length - MAX_AUDIO_BUFFER_ENTRIES;
        expect(lru.evicted.length).toBe(overflow);

        // LRU policy: the earliest-inserted buffers are the ones evicted...
        expect(lru.evicted).toEqual(generatedIds.slice(0, overflow));
        // ...and the most-recently-inserted cap-worth survive in memory.
        const survivors = generatedIds.slice(overflow);
        expect([...lru.cache.keys()]).toEqual(survivors);
        for (const id of survivors) {
            expect(lru.cache.has(id)).toBe(true);
        }
    });

    it('propagates a persistence quota failure and leaves the seed flag unset so a retry can re-seed', async () => {
        const ctx = createMockAudioContext();
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
        expect(vi.mocked(cacheAudioBuffer).mock.calls.length).toBeGreaterThanOrEqual(60);
    });

    it('is idempotent — skips seeding when the flag is present', async () => {
        localStorage.setItem(FACTORY_SEED_FLAG_KEY, '1');
        const ctx = createMockAudioContext();
        await seedFactoryLibrary(ctx);

        expect(mocks.addLibraryRoot).not.toHaveBeenCalled();
        expect(mocks.addSamples).not.toHaveBeenCalled();
        expect(cacheAudioBuffer).not.toHaveBeenCalled();
    });

    it('does not re-add the factory root if one already exists', async () => {
        mocks.libraryStoreValue.value = {
            roots: [{ id: 'factory' }],
            samples: [],
        } as unknown as typeof mocks.libraryStoreValue.value;

        const ctx = createMockAudioContext();
        await seedFactoryLibrary(ctx);

        expect(mocks.addLibraryRoot).not.toHaveBeenCalled();
        expect(mocks.addSamples).toHaveBeenCalledTimes(1);
    });
});
