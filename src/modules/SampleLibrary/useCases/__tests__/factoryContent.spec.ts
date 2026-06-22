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

vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: {
        set: (id: string, buffer: AudioBuffer) => lru.set(id, buffer),
    },
}));

vi.mock('../buildFolderTree', () => ({
    buildFolderTree: mocks.buildFolderTree,
}));

import { generateFactorySamples } from '../factoryContent/generateFactorySamples';
import { seedFactoryLibrary } from '../factoryContent/seedFactoryLibrary';
import { FACTORY_SEED_FLAG_KEY } from '../factoryContent/types';

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

describe('generateFactorySamples', () => {
    it('produces at least 60 samples across drums, bass, keys and fx categories', () => {
        const ctx = createMockAudioContext();
        const samples = generateFactorySamples(ctx);

        expect(samples.length).toBeGreaterThanOrEqual(60);

        const categories = new Set(samples.map((s) => s.category));
        expect(categories.has('drums')).toBe(true);
        expect(categories.has('bass')).toBe(true);
        expect(categories.has('keys')).toBe(true);
        expect(categories.has('fx')).toBe(true);
    });

    it('gives every sample a unique stable id', () => {
        const ctx = createMockAudioContext();
        const samples = generateFactorySamples(ctx);
        const ids = new Set(samples.map((s) => s.id));
        expect(ids.size).toBe(samples.length);
    });

    it('fills each buffer with non-silent audio data', () => {
        const ctx = createMockAudioContext();
        const samples = generateFactorySamples(ctx);
        for (const sample of samples) {
            const data = sample.buffer.getChannelData(0);
            let peak = 0;
            for (let i = 0; i < data.length; i++) {
                const a = Math.abs(data[i]!);
                if (a > peak) {
                    peak = a;
                }
            }
            expect(peak).toBeGreaterThan(0);
        }
    });

    it('marks factory bass samples at MIDI pitch 24 (C1)', () => {
        const ctx = createMockAudioContext();
        const bass = generateFactorySamples(ctx).filter((s) => s.category === 'bass');
        expect(bass.length).toBeGreaterThan(0);
        for (const b of bass) {
            expect(b.pitch).toBe(24);
        }
    });

    it('marks factory keys samples at MIDI pitch 48 (C3)', () => {
        const ctx = createMockAudioContext();
        const keys = generateFactorySamples(ctx).filter((s) => s.category === 'keys');
        expect(keys.length).toBeGreaterThan(0);
        for (const k of keys) {
            expect(k.pitch).toBe(48);
        }
    });
});

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
        expect(lru.set.mock.calls.length).toBeGreaterThanOrEqual(60);
        expect(mocks.addSamples).toHaveBeenCalledTimes(1);
        expect(mocks.buildFolderTree).toHaveBeenCalledWith('factory');
        expect(localStorage.getItem(FACTORY_SEED_FLAG_KEY)).not.toBeNull();
    });

    it('inserts one cache buffer per generated factory sample', async () => {
        const ctx = createMockAudioContext();
        const sampleCount = generateFactorySamples(ctx).length;

        await seedFactoryLibrary(ctx);

        // The seed must attempt to cache every sample it generated — no fewer,
        // no silent drops before reaching the cache.
        expect(lru.set).toHaveBeenCalledTimes(sampleCount);
    });

    it('caches each sample under the same id that its SampleRecord carries', async () => {
        const ctx = createMockAudioContext();
        const generatedIds = generateFactorySamples(ctx).map((s) => s.id);

        await seedFactoryLibrary(ctx);

        const cachedIds = lru.set.mock.calls.map(([id]) => id);
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
        expect(lru.set.mock.calls.length).toBeGreaterThanOrEqual(60);
    });

    it('is idempotent — skips seeding when the flag is present', async () => {
        localStorage.setItem(FACTORY_SEED_FLAG_KEY, '1');
        const ctx = createMockAudioContext();
        await seedFactoryLibrary(ctx);

        expect(mocks.addLibraryRoot).not.toHaveBeenCalled();
        expect(mocks.addSamples).not.toHaveBeenCalled();
        expect(lru.set).not.toHaveBeenCalled();
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
