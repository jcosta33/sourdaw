import { describe, it, expect, vi, beforeEach } from 'vitest';

// `cache` stands in for the AudioEngine buffer cache and `stored` for the PCM
// its IndexedDB store holds, from this launch or an earlier one; `unwritten`
// for the PCM a write of this session holds before it lands; `unreadable`
// holds ids whose stored record exists but cannot be read now. Each case
// observes which source (memory, storage, a fresh render) supplied the buffer.
type TestRoot = { id: string; status?: string; fileCount?: number };

const mocks = vi.hoisted(() => {
    const cache = new Map<string, AudioBuffer>();
    const stored = new Map<string, AudioBuffer>();
    const unwritten = new Map<string, AudioBuffer>();
    const unreadable = new Set<string>();
    const libraryStoreValue: { value: { roots: TestRoot[]; samples: { id: string; libraryRootId: string }[] } } = {
        value: { roots: [], samples: [] },
    };
    return {
        cache,
        stored,
        unwritten,
        unreadable,
        libraryStoreValue,
        audioContext: {},
        releaseHold: vi.fn(),
        cacheAudioBuffer: vi.fn(({ buffer, bufferId }: { buffer: AudioBuffer; bufferId: string }): string => {
            cache.set(bufferId, buffer);
            return bufferId;
        }),
        getCachedAudioBuffer: vi.fn(({ bufferId }: { bufferId: string }) => cache.get(bufferId) ?? null),
        holdAudioBufferForSession: vi.fn(({ buffer, bufferId }: { buffer: AudioBuffer; bufferId: string }) => {
            cache.set(bufferId, buffer);
        }),
        restoreUnpinnedAudioBuffersFromIdb: vi.fn(async ({ bufferIds }: { bufferIds: readonly string[] }) => {
            const absentIds: string[] = [];
            for (const id of bufferIds) {
                const buffer = stored.get(id) ?? unwritten.get(id);
                if (cache.has(id) || unreadable.has(id)) {
                    continue;
                }
                if (buffer) {
                    cache.set(id, buffer);
                } else {
                    absentIds.push(id);
                }
            }
            return { absentIds, release: mocks.releaseHold };
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
    holdAudioBufferForSession: mocks.holdAudioBufferForSession,
    restoreUnpinnedAudioBuffersFromIdb: mocks.restoreUnpinnedAudioBuffersFromIdb,
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

type RenderedSample = Awaited<ReturnType<typeof renderFactorySamples>>[number];

const PACK_SIZE = 6;

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

function cachedIds(): string[] {
    return mocks.cacheAudioBuffer.mock.calls.map(([call]) => call.bufferId);
}

describe('ensureFactorySampleBuffer', () => {
    let rendered: RenderedSample[];

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.cache.clear();
        mocks.stored.clear();
        mocks.unwritten.clear();
        mocks.unreadable.clear();
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

        expect(mocks.restoreUnpinnedAudioBuffersFromIdb).not.toHaveBeenCalled();
        expect(renderFactorySamples).not.toHaveBeenCalled();
    });

    it('leaves a sample of another root to its own file path', async () => {
        await expect(ensureFactorySampleBuffer({ sampleId: 'user-loop' })).resolves.toEqual({
            status: 'not-factory',
        });

        expect(mocks.restoreUnpinnedAudioBuffersFromIdb).not.toHaveBeenCalled();
        expect(renderFactorySamples).not.toHaveBeenCalled();
    });

    it('restores a cold sample from the PCM an earlier launch stored, without a render', async () => {
        const restored = storedBuffer('factory-test-1');
        mocks.stored.set('factory-test-1', restored);

        await expect(ensureFactorySampleBuffer({ sampleId: 'factory-test-1' })).resolves.toEqual({
            status: 'resolved',
            buffer: restored,
        });

        expect(mocks.restoreUnpinnedAudioBuffersFromIdb).toHaveBeenCalledExactlyOnceWith({
            bufferIds: ['factory-test-1'],
        });
        expect(mocks.releaseHold).toHaveBeenCalledTimes(1);
        expect(renderFactorySamples).not.toHaveBeenCalled();
        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
    });

    it('restores an evicted sample whose write has not landed from the PCM it holds, without a render', async () => {
        const unwritten = storedBuffer('factory-test-1');
        mocks.unwritten.set('factory-test-1', unwritten);

        await expect(ensureFactorySampleBuffer({ sampleId: 'factory-test-1' })).resolves.toEqual({
            status: 'resolved',
            buffer: unwritten,
        });

        expect(renderFactorySamples).not.toHaveBeenCalled();
        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
    });

    it('renders the pack once for concurrent requests storage holds nothing for, caching only those', async () => {
        const [first, second] = await Promise.all([
            ensureFactorySampleBuffer({ sampleId: 'factory-test-3' }),
            ensureFactorySampleBuffer({ sampleId: 'factory-test-4' }),
        ]);

        expect(renderFactorySamples).toHaveBeenCalledExactlyOnceWith(mocks.audioContext);
        expect(first).toEqual({ status: 'resolved', buffer: rendered[3]!.buffer });
        expect(second).toEqual({ status: 'resolved', buffer: rendered[4]!.buffer });
        expect(cachedIds()).toEqual(['factory-test-3', 'factory-test-4']);
        expect(mocks.libraryStoreValue.value.roots[0]?.status).toBe('ready');
    });

    it('never caches, and so never persists, a rendered sample that has stored audio', async () => {
        // A saved project may play this stored take; a render of another build
        // can differ from it.
        const savedTake = storedBuffer('factory-test-2');
        mocks.stored.set('factory-test-2', savedTake);

        await expect(ensureFactorySampleBuffer({ sampleId: 'factory-test-3' })).resolves.toEqual({
            status: 'resolved',
            buffer: rendered[3]!.buffer,
        });

        expect(renderFactorySamples).toHaveBeenCalledTimes(1);
        expect(cachedIds()).toEqual(['factory-test-3']);
        expect(mocks.cache.has('factory-test-2')).toBe(false);
    });

    it('plays a render for this session, and stores none, when storage cannot be read', async () => {
        // The failed read may have hidden a stored take the render must not overwrite.
        mocks.unreadable.add('factory-test-3');

        await expect(ensureFactorySampleBuffer({ sampleId: 'factory-test-3' })).resolves.toEqual({
            status: 'resolved',
            buffer: rendered[3]!.buffer,
        });

        expect(renderFactorySamples).toHaveBeenCalledTimes(1);
        expect(mocks.holdAudioBufferForSession).toHaveBeenCalledExactlyOnceWith({
            buffer: rendered[3]!.buffer,
            bufferId: 'factory-test-3',
        });
        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
    });

    it('reports the buffer unavailable and the root offline when the render fails', async () => {
        vi.mocked(renderFactorySamples).mockRejectedValueOnce(new Error('render-timed-out'));

        await expect(ensureFactorySampleBuffer({ sampleId: 'factory-test-3' })).resolves.toEqual({
            status: 'unavailable',
        });

        expect(mocks.cache.has('factory-test-3')).toBe(false);
        expect(mocks.libraryStoreValue.value.roots[0]?.status).toBe('offline');
    });

    it('caches nothing when the user disconnects the root while the pack renders', async () => {
        vi.mocked(renderFactorySamples).mockImplementationOnce(async () => {
            mocks.libraryStoreValue.value = { roots: [], samples: [] };
            return rendered;
        });

        await expect(ensureFactorySampleBuffer({ sampleId: 'factory-test-3' })).resolves.toEqual({
            status: 'unavailable',
        });

        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.libraryStoreValue.value.samples).toEqual([]);
    });

    it('caches nothing when the user disconnects the root as the render settles', async () => {
        // The pack's own check has passed; the disconnect lands with its ready status.
        mocks.updateLibraryRootStatus
            .mockImplementationOnce(() => undefined)
            .mockImplementationOnce(() => {
                mocks.libraryStoreValue.value = { roots: [], samples: [] };
            });

        await expect(ensureFactorySampleBuffer({ sampleId: 'factory-test-3' })).resolves.toEqual({
            status: 'unavailable',
        });

        expect(renderFactorySamples).toHaveBeenCalledTimes(1);
        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.cache.has('factory-test-3')).toBe(false);
    });

    it('reports a factory sample unavailable once the user disconnected its root', async () => {
        mocks.libraryStoreValue.value = { ...mocks.libraryStoreValue.value, roots: [] };

        await expect(ensureFactorySampleBuffer({ sampleId: 'factory-test-3' })).resolves.toEqual({
            status: 'unavailable',
        });

        expect(renderFactorySamples).not.toHaveBeenCalled();
    });
});
