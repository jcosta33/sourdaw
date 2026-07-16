import { beforeEach, describe, expect, it } from 'vitest';

import { type GrinderImportedNeuralModel } from '../../models/GrinderPatch';
import {
    DEFAULT_GRINDER_NEURAL_LIBRARY_STATE,
    grinderNeuralLibraryStore,
    removeGrinderNeuralLibraryEntry,
    upsertGrinderNeuralLibraryEntries,
} from '../grinderNeuralLibraryStore';

function make_entry(input: { id: string; imported_at: number }): GrinderImportedNeuralModel {
    return {
        id: input.id,
        source: 'imported',
        name: `Model ${input.id}`,
        family: 'NAM import',
        placement: 'amp-capture',
        description: 'Test entry',
        importedAt: input.imported_at,
        sourceFileName: `${input.id}.nam`,
        sourceFileText: null,
        profile: {
            derivedFrom: 'nam',
            sourceArchitecture: 'WaveNet',
            sourceSampleRate: 48_000,
            sourceWeightCount: 6,
            preferredTier: 'standard',
            inputDrive: 1.1,
            asymmetry: 0.03,
            outputTrim: 0.9,
            contourMix: 0.2,
            recurrentBias: 0.01,
            convWeights: [[0.1, 0.7, 0.2]],
        },
    };
}

describe('grinderNeuralLibraryStore', () => {
    beforeEach(() => {
        grinderNeuralLibraryStore.set(DEFAULT_GRINDER_NEURAL_LIBRARY_STATE);
    });

    it('should preserve an in-flight importing flag through an entry upsert', () => {
        // upsertGrinderNeuralLibraryEntries writes a full state object; the importing flag
        // belongs to whichever import run set it, so a concurrent library mutation (the
        // import's own upsert, or a restore) must carry it forward, not silently reset it.
        grinderNeuralLibraryStore.set({
            ...DEFAULT_GRINDER_NEURAL_LIBRARY_STATE,
            importing: true,
        });

        upsertGrinderNeuralLibraryEntries([make_entry({ id: 'voice-a', imported_at: 100 })]);

        expect(grinderNeuralLibraryStore.value?.importing).toBe(true);
        expect(grinderNeuralLibraryStore.value?.entries.map((entry) => entry.id)).toEqual(['voice-a']);
    });

    it('should preserve an in-flight importing flag through an entry removal', () => {
        grinderNeuralLibraryStore.set({
            ...DEFAULT_GRINDER_NEURAL_LIBRARY_STATE,
            importing: true,
            entries: [make_entry({ id: 'voice-a', imported_at: 100 }), make_entry({ id: 'voice-b', imported_at: 200 })],
        });

        const remaining = removeGrinderNeuralLibraryEntry('voice-a');

        expect(remaining.map((entry) => entry.id)).toEqual(['voice-b']);
        expect(grinderNeuralLibraryStore.value?.importing).toBe(true);
    });

    it('should leave the importing flag false when no import is in flight', () => {
        upsertGrinderNeuralLibraryEntries([make_entry({ id: 'voice-a', imported_at: 100 })]);
        removeGrinderNeuralLibraryEntry('voice-a');

        expect(grinderNeuralLibraryStore.value?.importing).toBe(false);
    });
});
