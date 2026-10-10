import { describe, expect, it } from 'vitest';

import { compileRuntimeGrinderNeuralPatch } from '../compileRuntimeGrinderNeuralPatch';

function createPatch(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        schemaVersion: 1,
        command: 'apply-grinder-neural-patch',
        target: { trackId: 'track-1', deviceId: 'grinder-1', deviceType: 'grinder' },
        patch: {
            neuralModelMode: 'imported',
            profile: {
                preferredTier: 'recurrent',
                inputDrive: 1.5,
                asymmetry: 0.25,
                outputTrim: -3,
                contourMix: 0.7,
                recurrentBias: 0.1,
                convWeights: [[0.1, 0.2, 0.3]],
            },
        },
        correlation: { workletGeneration: 7, controlSequence: 3 },
        scheduling: { targetFrame: null, deadlineFrame: null },
        ...overrides,
    };
}

describe('compileRuntimeGrinderNeuralPatch', () => {
    it('compiles and deep-freezes the exact immediate v1 neural patch', () => {
        const result = compileRuntimeGrinderNeuralPatch(createPatch());

        expect(result).toMatchObject({ status: 'compiled', patch: createPatch() });
        if (result.status === 'compiled') {
            expect(Object.isFrozen(result.patch)).toBe(true);
            expect(Object.isFrozen(result.patch.target)).toBe(true);
            expect(Object.isFrozen(result.patch.patch)).toBe(true);
            expect(Object.isFrozen(result.patch.correlation)).toBe(true);
            expect(Object.isFrozen(result.patch.scheduling)).toBe(true);
        }
    });

    it.each([
        ['unknown root key', createPatch({ unexpected: true })],
        [
            'wrong target type',
            createPatch({ target: { trackId: 'track-1', deviceId: 'grinder-1', deviceType: 'bacteria' } }),
        ],
        [
            'non-finite scalar',
            createPatch({ patch: { neuralModelMode: 'imported', profile: { inputDrive: Number.NaN } } }),
        ],
        [
            'malformed weight triple',
            createPatch({ patch: { neuralModelMode: 'imported', profile: { convWeights: [[0.1, 0.2]] } } }),
        ],
        [
            'more than ten weight layers',
            createPatch({
                patch: {
                    neuralModelMode: 'imported',
                    profile: { convWeights: Array.from({ length: 11 }, () => [0.1, 0.2, 0.3]) },
                },
            }),
        ],
        ['non-immediate timing', createPatch({ scheduling: { targetFrame: 48_000, deadlineFrame: 48_128 } })],
    ])('rejects %s before it reaches the worklet', (_label, patch) => {
        expect(compileRuntimeGrinderNeuralPatch(patch)).toMatchObject({ status: 'invalid' });
    });

    it('admits a profile carrying the model fields the project patch adds (#3774)', () => {
        const result = compileRuntimeGrinderNeuralPatch(
            createPatch({
                patch: {
                    neuralModelMode: 'imported',
                    profile: {
                        preferredTier: 'recurrent',
                        convWeights: [[0.1, 0.2, 0.3]],
                        derivedFrom: 'nam',
                        modelDigest: '0123-4567-89ab-cdef',
                        model: { architecture: 'WaveNet', config: {}, weights: [0.5] },
                    },
                },
            })
        );

        expect(result).toMatchObject({ status: 'compiled' });
    });

    it('carries a non-empty modelJson into the compiled patch, with its digest, and drops the raw model (#3774)', () => {
        const modelJson = '{"architecture":"WaveNet","config":{},"weights":[0.5]}';
        const result = compileRuntimeGrinderNeuralPatch(
            createPatch({
                patch: {
                    neuralModelMode: 'imported',
                    profile: {
                        convWeights: [[0.1, 0.2, 0.3]],
                        model: { architecture: 'WaveNet', config: {}, weights: [0.5] },
                        modelDigest: '0123-4567-89ab-cdef',
                    },
                    modelJson,
                },
            })
        );

        expect(result).toMatchObject({
            status: 'compiled',
            patch: { patch: { modelJson, modelDigest: '0123-4567-89ab-cdef' } },
        });
        if (result.status === 'compiled' && result.patch.patch.neuralModelMode === 'imported') {
            // The raw model object never crosses the runtime door: only the
            // serialized text the worklet hands to the wasm loader does, plus
            // the digest the worklet's re-load gate compares.
            expect(result.patch.patch).not.toHaveProperty('profile.model');
            expect(Object.isFrozen(result.patch.patch)).toBe(true);
        }
    });

    it.each([
        ['a null digest', null],
        ['an empty digest', ''],
        ['a non-string digest', 12],
    ])('compiles a model payload with %s without carrying a digest field', (_label, modelDigest) => {
        const result = compileRuntimeGrinderNeuralPatch(
            createPatch({
                patch: {
                    neuralModelMode: 'imported',
                    profile: {
                        convWeights: [[0.1, 0.2, 0.3]],
                        model: { architecture: 'WaveNet', config: {}, weights: [0.5] },
                        modelDigest: modelDigest as unknown as string,
                    },
                    modelJson: '{"architecture":"WaveNet","config":{},"weights":[0.5]}',
                },
            })
        );

        expect(result).toMatchObject({ status: 'compiled' });
        if (result.status === 'compiled') {
            expect(result.patch.patch).not.toHaveProperty('modelDigest');
        }
    });

    it.each([
        ['empty string', ''],
        ['a number', 12],
        ['an object', { weights: [] }],
    ])('rejects a %s modelJson before it reaches the worklet', (_label, modelJson) => {
        const result = compileRuntimeGrinderNeuralPatch(
            createPatch({
                patch: {
                    neuralModelMode: 'imported',
                    profile: { convWeights: [[0.1, 0.2, 0.3]] },
                    modelJson: modelJson as unknown as string,
                },
            })
        );

        expect(result).toMatchObject({ status: 'invalid' });
    });
});
