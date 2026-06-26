import { beforeEach, describe, expect, it, vi } from 'vitest';

import { restoreGrinderNeuralLibraryResult } from '../../repositories/neuralLibraryPersistence/restoreGrinderNeuralLibrary';
import {
    DEFAULT_GRINDER_NEURAL_LIBRARY_STATE,
    grinderNeuralLibraryStore,
} from '../../stores/grinderNeuralLibraryStore';
import { restoreGrinderNeuralLibrary } from '../restoreGrinderNeuralLibrary';

vi.mock('../../repositories/neuralLibraryPersistence/restoreGrinderNeuralLibrary', () => ({
    restoreGrinderNeuralLibraryResult: vi.fn(),
}));

const restoreMock = vi.mocked(restoreGrinderNeuralLibraryResult);

describe('restoreGrinderNeuralLibrary use case', () => {
    beforeEach(() => {
        grinderNeuralLibraryStore.set(DEFAULT_GRINDER_NEURAL_LIBRARY_STATE);
        restoreMock.mockReset();
    });

    it('should surface the differentiated persistence error to the store instead of an empty library', async () => {
        // Regression for Obs. 2: a quota / schema / permission failure used to be
        // collapsed to `[]`, making a blocked restore indistinguishable from an
        // empty library. The specific message must reach the store's error field.
        restoreMock.mockResolvedValue({
            ok: false,
            error: { code: 'permission_denied', message: 'Storage access was denied.' },
        });

        await restoreGrinderNeuralLibrary();

        const state = grinderNeuralLibraryStore.value;
        expect(state?.error).toBe('Storage access was denied.');
        expect(state?.entries).toEqual([]);
        expect(state?.loading).toBe(false);
        expect(state?.hydrated).toBe(true);
    });

    it('should populate entries and clear the error on a successful restore', async () => {
        restoreMock.mockResolvedValue({
            ok: true,
            entries: [
                {
                    id: 'imported-1',
                    source: 'imported',
                    name: 'Imported One',
                    family: 'NAM import',
                    placement: 'amp-capture',
                    description: 'Imported from one.nam',
                    importedAt: 1,
                    sourceFileName: 'one.nam',
                    sourceFileText: '{"name":"one"}',
                    profile: {
                        derivedFrom: 'nam',
                        sourceArchitecture: 'WaveNet',
                        sourceSampleRate: 48_000,
                        sourceWeightCount: 12,
                        preferredTier: 'standard',
                        inputDrive: 1.1,
                        asymmetry: 0.02,
                        outputTrim: 0.9,
                        contourMix: 0.2,
                        recurrentBias: 0.01,
                        convWeights: [[0.1, 0.7, 0.2]],
                    },
                },
            ],
        });

        await restoreGrinderNeuralLibrary();

        const state = grinderNeuralLibraryStore.value;
        expect(state?.error).toBeNull();
        expect(state?.entries.map((entry) => entry.id)).toEqual(['imported-1']);
        expect(state?.hydrated).toBe(true);
    });
});
