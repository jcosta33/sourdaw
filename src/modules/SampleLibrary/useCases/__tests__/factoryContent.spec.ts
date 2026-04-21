import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    libraryStoreValue: { value: { roots: [], samples: [] } },
    addLibraryRoot: vi.fn(),
    addSamples: vi.fn(),
    persistLibraryRoots: vi.fn(async () => {}),
    persistSamples: vi.fn(async () => {}),
    audioBufferCacheSet: vi.fn(),
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
        set: mocks.audioBufferCacheSet,
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
    });

    it('seeds all factory content on first launch', async () => {
        const ctx = createMockAudioContext();
        await seedFactoryLibrary(ctx);

        expect(mocks.addLibraryRoot).toHaveBeenCalledTimes(1);
        expect(mocks.audioBufferCacheSet.mock.calls.length).toBeGreaterThanOrEqual(60);
        expect(mocks.addSamples).toHaveBeenCalledTimes(1);
        expect(mocks.buildFolderTree).toHaveBeenCalledWith('factory');
        expect(localStorage.getItem(FACTORY_SEED_FLAG_KEY)).not.toBeNull();
    });

    it('is idempotent — skips seeding when the flag is present', async () => {
        localStorage.setItem(FACTORY_SEED_FLAG_KEY, '1');
        const ctx = createMockAudioContext();
        await seedFactoryLibrary(ctx);

        expect(mocks.addLibraryRoot).not.toHaveBeenCalled();
        expect(mocks.addSamples).not.toHaveBeenCalled();
        expect(mocks.audioBufferCacheSet).not.toHaveBeenCalled();
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
