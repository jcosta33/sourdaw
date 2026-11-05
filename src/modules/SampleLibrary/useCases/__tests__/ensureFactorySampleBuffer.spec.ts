import { describe, it, expect, vi, beforeEach } from 'vitest';

// A small LRU stands in for the AudioEngine buffer cache, and `stored` for the
// PCM its IndexedDB store holds, so each case observes which of the three
// sources (memory, storage, a fresh render) supplied the buffer.
const CACHE_CAPACITY = 4;

type TestRoot = { id: string; status?: string; fileCount?: number };

const mocks = vi.hoisted(() => {
    const cache = new Map<string, AudioBuffer>();
    const stored = new Map<string, AudioBuffer>();
    const libraryStoreValue: { value: { roots: TestRoot[]; samples: { id: string; libraryRootId: string }[] } } = {
        value: { roots: [], samples: [] },
    };
    return {
        cache,
        stored,
        libraryStoreValue,
        audioContext: {},
        releaseHold: vi.fn(),
        cacheAudioBuffer: vi.fn(({ buffer, bufferId }: { buffer: AudioBuffer; bufferId: string }): string => {
            cache.delete(bufferId);
            if (cache.size >= 4) {
                const oldest = cache.keys().next().value;
                if (oldest !== undefined) {
                    cache.delete(oldest);
                }
            }
            cache.set(bufferId, buffer);
            return bufferId;
        }),
        // Promotes on read, as the real cache does.
        getCachedAudioBuffer: vi.fn(({ bufferId }: { bufferId: string }) => {
            const buffer = cache.get(bufferId);
            if (buffer === undefined) {
                return null;
            }
            cache.delete(bufferId);
            cache.set(bufferId, buffer);
            return buffer;
        }),
        prepareCachedAudioBuffersForReplay: vi.fn(async (ids: readonly string[]) => {
            for (const id of ids) {
                const buffer = stored.get(id);
                if (buffer && !cache.has(id)) {
                    cache.set(id, buffer);
                }
            }
            return mocks.releaseHold;
        }),
        updateLibraryRootStatus: vi.fn((rootId: string, status: string, fileCount?: number) => {
            const state = libraryStoreValue.value;
            libraryStoreValue.value = {
                ...state,
                roots: state.roots.map((root) =>
                    root.id === rootId ? { ...root, status, fileCount: fileCount ?? root.fileCount } : root
                ),
            };
        }),
        addSamples: vi.fn((records: { id: string; libraryRootId: string }[]) => {
            const state = libraryStoreValue.value;
            libraryStoreValue.value = { ...state, samples: [...state.samples, ...records] };
        }),
        buildFolderTree: vi.fn(),
    };
});

vi.mock('#/modules/AudioEngine/useCases', () => ({
    cacheAudioBuffer: mocks.cacheAudioBuffer,
    getAudioContext: () => mocks.audioContext,
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
    prepareCachedAudioBuffersForReplay: mocks.prepareCachedAudioBuffersForReplay,
}));

vi.mock('../../stores/libraryStore', () => ({
    libraryStore: {
        get value() {
            return mocks.libraryStoreValue.value;
        },
    },
    addSamples: mocks.addSamples,
    updateLibraryRootStatus: mocks.updateLibraryRootStatus,
}));

vi.mock('../buildFolderTree', () => ({ buildFolderTree: mocks.buildFolderTree }));

vi.mock('#/modules/FactorySynthesis/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/FactorySynthesis/useCases')>()),
    renderFactorySamples: vi.fn(),
}));

import { renderFactorySamples } from '#/modules/FactorySynthesis/useCases';

import { ensureFactorySampleBuffer } from '../ensureFactorySampleBuffer';
import { reloadFactoryLibraryBuffers } from '../factoryLibrary/reloadFactoryLibraryBuffers';

type RenderedSample = Awaited<ReturnType<typeof renderFactorySamples>>[number];

// More samples than the cache holds, so a full render evicts its own first ones.
const PACK_SIZE = 6;
// The pack is cached in chunks of this many, yielding between them.
const CACHE_CHUNK = 16;

function createRenderedSample(index: number): RenderedSample {
    const buffer = { length: 100 + index, numberOfChannels: 1, sampleRate: 44100, duration: 1 };
    return {
        id: `factory-test-${index}`,
        name: `Test ${index}`,
        category: 'drums',
        tags: ['test'],
        buffer: buffer as unknown as AudioBuffer,
    };
}

function storedBuffer(id: string): AudioBuffer {
    return { id, source: 'stored' } as unknown as AudioBuffer;
}

describe('ensureFactorySampleBuffer', () => {
    let rendered: RenderedSample[];

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.cache.clear();
        mocks.stored.clear();
        rendered = Array.from({ length: PACK_SIZE }, (_, index) => createRenderedSample(index));
        vi.mocked(renderFactorySamples).mockResolvedValue(rendered);
        mocks.libraryStoreValue.value = {
            roots: [{ id: 'factory', status: 'ready', fileCount: PACK_SIZE }],
            samples: [
                ...rendered.map((sample) => ({ id: sample.id, libraryRootId: 'factory' })),
                { id: 'user-loop', libraryRootId: 'connected-root' },
            ],
        };
    });

    it('returns the resident buffer without touching storage or rendering', async () => {
        const resident = storedBuffer('factory-test-2');
        mocks.cache.set('factory-test-2', resident);

        await expect(ensureFactorySampleBuffer({ sampleId: 'factory-test-2' })).resolves.toEqual({
            status: 'resolved',
            buffer: resident,
        });

        expect(mocks.prepareCachedAudioBuffersForReplay).not.toHaveBeenCalled();
        expect(renderFactorySamples).not.toHaveBeenCalled();
    });

    it('leaves a sample of another root to its own file path', async () => {
        await expect(ensureFactorySampleBuffer({ sampleId: 'user-loop' })).resolves.toEqual({
            status: 'not-factory',
        });

        expect(mocks.prepareCachedAudioBuffersForReplay).not.toHaveBeenCalled();
        expect(renderFactorySamples).not.toHaveBeenCalled();
    });

    it('restores an evicted buffer from its stored PCM without a render', async () => {
        const restored = storedBuffer('factory-test-1');
        mocks.stored.set('factory-test-1', restored);

        await expect(ensureFactorySampleBuffer({ sampleId: 'factory-test-1' })).resolves.toEqual({
            status: 'resolved',
            buffer: restored,
        });

        expect(mocks.prepareCachedAudioBuffersForReplay).toHaveBeenCalledExactlyOnceWith(['factory-test-1']);
        expect(mocks.releaseHold).toHaveBeenCalledTimes(1);
        expect(renderFactorySamples).not.toHaveBeenCalled();
    });

    it('renders the pack once for concurrent requests whose PCM is not stored', async () => {
        const [first, second] = await Promise.all([
            ensureFactorySampleBuffer({ sampleId: 'factory-test-3' }),
            ensureFactorySampleBuffer({ sampleId: 'factory-test-4' }),
        ]);

        expect(renderFactorySamples).toHaveBeenCalledExactlyOnceWith(mocks.audioContext);
        expect(first).toEqual({ status: 'resolved', buffer: rendered[3]!.buffer });
        expect(second).toEqual({ status: 'resolved', buffer: rendered[4]!.buffer });
        expect(mocks.libraryStoreValue.value.roots[0]?.status).toBe('ready');
    });

    it('keeps the requested buffer resident when the render evicts it', async () => {
        // The pack outgrows the cache, so caching it in order evicts sample 0.
        const result = await ensureFactorySampleBuffer({ sampleId: 'factory-test-0' });

        expect(result).toEqual({ status: 'resolved', buffer: rendered[0]!.buffer });
        expect(mocks.cache.get('factory-test-0')).toBe(rendered[0]!.buffer);
        expect(mocks.cache.size).toBe(CACHE_CAPACITY);
    });

    it('never replaces a resident buffer with its re-rendered copy', async () => {
        // An open project may hold this buffer pinned; a render must leave it be.
        vi.mocked(renderFactorySamples).mockResolvedValueOnce(rendered.slice(0, 3));
        const resident = storedBuffer('factory-test-2');
        mocks.cache.set('factory-test-2', resident);

        await expect(ensureFactorySampleBuffer({ sampleId: 'factory-test-1' })).resolves.toEqual({
            status: 'resolved',
            buffer: rendered[1]!.buffer,
        });

        expect(mocks.getCachedAudioBuffer({ bufferId: 'factory-test-2' })).toBe(resident);
        const cachedIds = mocks.cacheAudioBuffer.mock.calls.map(([call]) => call.bufferId);
        expect(cachedIds).toEqual(['factory-test-0', 'factory-test-1']);
    });

    it('leaves nothing behind when the user disconnects the root while the pack is cached', async () => {
        const pack = Array.from({ length: CACHE_CHUNK + 4 }, (_, index) => createRenderedSample(index));
        const requested = pack[CACHE_CHUNK - 1]!.id;
        vi.mocked(renderFactorySamples).mockImplementationOnce(async () => {
            // Runs during the yield after the first chunk is cached.
            setTimeout(() => {
                mocks.libraryStoreValue.value = { roots: [], samples: [] };
            }, 0);
            return pack;
        });
        mocks.libraryStoreValue.value = {
            roots: [{ id: 'factory', status: 'ready', fileCount: pack.length }],
            samples: [{ id: requested, libraryRootId: 'factory' }],
        };

        const [result, reloaded] = await Promise.all([
            ensureFactorySampleBuffer({ sampleId: requested }),
            reloadFactoryLibraryBuffers(mocks.audioContext as AudioContext),
        ]);

        expect(result).toEqual({ status: 'unavailable' });
        expect(reloaded).toEqual([]);
        expect(renderFactorySamples).toHaveBeenCalledTimes(1);
        expect(mocks.cacheAudioBuffer).toHaveBeenCalledTimes(CACHE_CHUNK);
        expect(mocks.libraryStoreValue.value.samples).toEqual([]);
        expect(mocks.buildFolderTree).not.toHaveBeenCalled();
        expect(mocks.libraryStoreValue.value.roots).toEqual([]);
    });

    it('reports the buffer unavailable and the root offline when the render fails', async () => {
        vi.mocked(renderFactorySamples).mockRejectedValueOnce(new Error('render-timed-out'));

        await expect(ensureFactorySampleBuffer({ sampleId: 'factory-test-3' })).resolves.toEqual({
            status: 'unavailable',
        });

        expect(mocks.cache.has('factory-test-3')).toBe(false);
        expect(mocks.libraryStoreValue.value.roots[0]?.status).toBe('offline');
    });

    it('reports a factory sample unavailable once the user disconnected its root', async () => {
        mocks.libraryStoreValue.value = { ...mocks.libraryStoreValue.value, roots: [] };

        await expect(ensureFactorySampleBuffer({ sampleId: 'factory-test-3' })).resolves.toEqual({
            status: 'unavailable',
        });

        expect(renderFactorySamples).not.toHaveBeenCalled();
    });
});
