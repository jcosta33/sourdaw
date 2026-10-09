import { describe, expect, it } from 'vitest';

import { validateGrinderNamModel } from '../../services/validateGrinderNamModel';
import { grinderNeuralModelJson } from '../grinderNeuralModelJson';
import { grinderNeuralModelDigest } from '../GrinderNeuralProfileParams';
import { type GrinderNeuralModel } from '../GrinderPatch';

// Linear is the smallest fully-specified architecture: the validator derives
// its exact weight count (receptive_field + bias) and the 48 kHz record passes
// its rate gate, so a round trip through this model proves the serializer.
const model: GrinderNeuralModel = {
    architecture: 'Linear',
    version: '0.6.1',
    sampleRate: 48_000,
    config: { receptive_field: 3, bias: true },
    weights: [0.5, -0.25, 0.125, 0.031_25],
};

describe('grinderNeuralModelJson', () => {
    it('serializes to the document shape the runtime parses', () => {
        expect(JSON.parse(grinderNeuralModelJson(model))).toEqual({
            architecture: 'Linear',
            version: '0.6.1',
            sample_rate: 48_000,
            config: model.config,
            weights: [0.5, -0.25, 0.125, 0.031_25],
        });
    });

    it('omits the keys a version-less, rate-less legacy export does not carry', () => {
        const legacy: GrinderNeuralModel = { ...model, version: null, sampleRate: null };
        const parsed = JSON.parse(grinderNeuralModelJson(legacy)) as Record<string, unknown>;
        expect(parsed).not.toHaveProperty('version');
        expect(parsed).not.toHaveProperty('sample_rate');
        expect(parsed).toHaveProperty('architecture');
        expect(parsed).toHaveProperty('config');
        expect(parsed).toHaveProperty('weights');
    });

    it('round-trips through the validator with the digest unchanged', () => {
        const roundTripped = validateGrinderNamModel(JSON.parse(grinderNeuralModelJson(model)), 'round.nam');
        expect(roundTripped.architecture).toBe(model.architecture);
        expect(roundTripped.version).toBe(model.version);
        expect(roundTripped.sampleRate).toBe(model.sampleRate);
        expect(roundTripped.weights).toEqual([...model.weights]);
        expect(grinderNeuralModelDigest(roundTripped)).toBe(grinderNeuralModelDigest(model));
    });
});
