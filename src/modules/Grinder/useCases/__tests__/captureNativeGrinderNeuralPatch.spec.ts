import { afterEach, describe, expect, it } from 'vitest';

import { grinderNeuralProfileParams } from '../../models/GrinderNeuralProfileParams';
import { parseGrinderNamFile } from '../../services/parseGrinderNamFile';
import {
    grinderNeuralLibraryStore,
    DEFAULT_GRINDER_NEURAL_LIBRARY_STATE,
} from '../../stores/grinderNeuralLibraryStore';
import { captureNativeGrinderNeuralPatch } from '../captureNativeGrinderNeuralPatch';

const document = {
    architecture: 'Linear',
    version: '0.5.4',
    sample_rate: 48000,
    config: { receptive_field: 2, bias: false },
    weights: [0.25, -0.5],
};

describe('captureNativeGrinderNeuralPatch', () => {
    afterEach(() => {
        grinderNeuralLibraryStore.set(DEFAULT_GRINDER_NEURAL_LIBRARY_STATE);
    });

    it('resolves an unopened saved record to all actual model weights and keeps its snapshot immutable', () => {
        const entry = parseGrinderNamFile({ file_name: 'test.nam', file_text: JSON.stringify(document) });
        grinderNeuralLibraryStore.set({ ...DEFAULT_GRINDER_NEURAL_LIBRARY_STATE, hydrated: true, entries: [entry] });
        const values = { neuralModelMode: 1, ...Object.fromEntries(grinderNeuralProfileParams(entry.profile)) };
        const captured = captureNativeGrinderNeuralPatch(values);
        expect(captured).toBeDefined();
        expect(JSON.parse(captured!.modelJson)).toEqual(document);
        grinderNeuralLibraryStore.set(DEFAULT_GRINDER_NEURAL_LIBRARY_STATE);
        expect(JSON.parse(captured!.modelJson).weights).toEqual([0.25, -0.5]);
        expect(() => captureNativeGrinderNeuralPatch(values)).toThrow(/unavailable/);
    });

    it('does not label a legacy scalar-only profile or factory slot as a full network', () => {
        expect(captureNativeGrinderNeuralPatch({ neuralModelMode: 0 })).toBeUndefined();
        expect(captureNativeGrinderNeuralPatch({ neuralModelMode: 1, neuralCustomInputDrive: 1 })).toBeUndefined();
    });
});
