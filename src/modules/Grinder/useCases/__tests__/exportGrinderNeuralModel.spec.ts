import { describe, expect, it, vi } from 'vitest';

import { exportGrinderNeuralModel } from '../exportGrinderNeuralModel';
import { downloadGrinderNeuralModelFile } from '../../repositories/neuralLibraryPersistence/downloadGrinderNeuralModelFile';

vi.mock('../../repositories/neuralLibraryPersistence/downloadGrinderNeuralModelFile', () => ({
    downloadGrinderNeuralModelFile: vi.fn(),
}));

describe('exportGrinderNeuralModel', () => {
    it('should export the preserved original NAM payload', () => {
        exportGrinderNeuralModel({
            id: 'imported-tight-rhythm',
            source: 'imported',
            name: 'Tight Rhythm',
            family: 'NAM import',
            placement: 'amp-capture',
            description: 'Imported from tight-rhythm.nam',
            importedAt: 1,
            sourceFileName: 'tight-rhythm.nam',
            sourceFileText: '{"hello":"world"}',
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
        });

        expect(downloadGrinderNeuralModelFile).toHaveBeenCalledWith({
            file_name: 'tight-rhythm.nam',
            file_text: '{"hello":"world"}',
        });
    });
});
