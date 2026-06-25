import { beforeEach, describe, expect, it, vi } from 'vitest';

import { persistGrinderNeuralLibrary } from '../../repositories/neuralLibraryPersistence/persistGrinderNeuralLibrary';
import { grinderNeuralLibraryStore } from '../../stores/grinderNeuralLibraryStore';
import { removeGrinderNeuralModel } from '../removeGrinderNeuralModel';

vi.mock('../../repositories/neuralLibraryPersistence/persistGrinderNeuralLibrary', () => ({
    persistGrinderNeuralLibrary: vi.fn(() => Promise.resolve({ ok: true })),
}));

describe('removeGrinderNeuralModel', () => {
    beforeEach(() => {
        grinderNeuralLibraryStore.set({
            hydrated: true,
            loading: false,
            error: null,
            entries: [
                {
                    id: 'imported-tight-rhythm',
                    source: 'imported',
                    name: 'Tight Rhythm',
                    family: 'NAM import',
                    placement: 'amp-capture',
                    description: 'Imported from tight-rhythm.nam',
                    importedAt: 2,
                    sourceFileName: 'tight-rhythm.nam',
                    sourceFileText: '{"name":"tight"}',
                    profile: {
                        derivedFrom: 'nam',
                        sourceArchitecture: 'WaveNet',
                        sourceSampleRate: 48_000,
                        sourceWeightCount: 12,
                        preferredTier: 'standard',
                        inputDrive: 1.18,
                        asymmetry: 0.04,
                        outputTrim: 0.9,
                        contourMix: 0.22,
                        recurrentBias: 0.02,
                        convWeights: [
                            [0.1, 0.7, 0.2],
                            [0.09, 0.68, 0.23],
                            [0.12, 0.66, 0.2],
                            [0.11, 0.67, 0.19],
                            [0.08, 0.72, 0.16],
                            [0.07, 0.74, 0.15],
                            [0.13, 0.64, 0.19],
                            [0.1, 0.69, 0.18],
                            [0.09, 0.7, 0.17],
                            [0.11, 0.68, 0.17],
                        ],
                    },
                },
                {
                    id: 'imported-cleans',
                    source: 'imported',
                    name: 'Clean Sparkle',
                    family: 'NAM import',
                    placement: 'amp-capture',
                    description: 'Imported from clean-sparkle.nam',
                    importedAt: 1,
                    sourceFileName: 'clean-sparkle.nam',
                    sourceFileText: '{"name":"clean"}',
                    profile: {
                        derivedFrom: 'nam',
                        sourceArchitecture: 'WaveNet',
                        sourceSampleRate: 44_100,
                        sourceWeightCount: 10,
                        preferredTier: 'lite',
                        inputDrive: 1.02,
                        asymmetry: 0.01,
                        outputTrim: 0.95,
                        contourMix: 0.16,
                        recurrentBias: 0.01,
                        convWeights: [
                            [0.1, 0.7, 0.2],
                            [0.09, 0.68, 0.23],
                            [0.12, 0.66, 0.2],
                            [0.11, 0.67, 0.19],
                            [0.08, 0.72, 0.16],
                            [0.07, 0.74, 0.15],
                            [0.13, 0.64, 0.19],
                            [0.1, 0.69, 0.18],
                            [0.09, 0.7, 0.17],
                            [0.11, 0.68, 0.17],
                        ],
                    },
                },
            ],
        });
    });

    it('should remove the requested imported model from the reusable library', async () => {
        await removeGrinderNeuralModel({ model_id: 'imported-tight-rhythm' });

        expect(grinderNeuralLibraryStore.value?.entries.map((entry) => entry.id)).toEqual(['imported-cleans']);
    });

    it('should leave the reusable library intact when removal cannot be persisted', async () => {
        vi.mocked(persistGrinderNeuralLibrary).mockResolvedValueOnce({
            ok: false,
            error: { code: 'unknown', message: 'boom' },
        });

        await removeGrinderNeuralModel({ model_id: 'imported-tight-rhythm' });

        expect(grinderNeuralLibraryStore.value?.entries.map((entry) => entry.id)).toEqual([
            'imported-tight-rhythm',
            'imported-cleans',
        ]);
        expect(grinderNeuralLibraryStore.value?.error).toMatch(/could not remove tight rhythm/i);
    });

    it('should serialize overlapping writes so the second snapshot reflects the first', async () => {
        // Regression for the non-atomic remove/import race (NEW-6). Two removals
        // are fired without awaiting the first. Each removal computes the entries
        // to persist from the *current* store inside the lock, so the second
        // must observe the first removal's store mutation rather than racing on a
        // stale two-entry snapshot. The persist mock yields control on the
        // microtask queue (await) to maximise the interleaving opportunity.
        const persisted_snapshots: string[][] = [];
        vi.mocked(persistGrinderNeuralLibrary).mockImplementation(async ({ entries }) => {
            // Force a real async boundary so a non-serialized implementation
            // would interleave the two removals here.
            await Promise.resolve();
            persisted_snapshots.push(entries.map((entry) => entry.id));
            return { ok: true };
        });

        await Promise.all([
            removeGrinderNeuralModel({ model_id: 'imported-tight-rhythm' }),
            removeGrinderNeuralModel({ model_id: 'imported-cleans' }),
        ]);

        // First write removes tight-rhythm (cleans remains); the second runs only
        // after the first's store mutation and removes cleans from the
        // already-reduced set, leaving an empty library. Without the lock both
        // would persist from the original two-entry store and the second snapshot
        // would still contain a "removed" sibling.
        expect(persisted_snapshots).toEqual([['imported-cleans'], []]);
        expect(grinderNeuralLibraryStore.value?.entries).toEqual([]);
    });
});
