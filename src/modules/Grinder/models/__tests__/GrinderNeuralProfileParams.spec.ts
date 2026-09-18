import { describe, expect, it } from 'vitest';

import { grinderNeuralProfileParams } from '../GrinderNeuralProfileParams';
import { type GrinderNeuralProfile } from '../GrinderPatch';

function buildProfile(convWeights: Array<[number, number, number]>): GrinderNeuralProfile {
    return {
        derivedFrom: 'nam',
        sourceArchitecture: 'wavenet',
        sourceSampleRate: 48_000,
        sourceWeightCount: convWeights.length * 3,
        preferredTier: 'lite',
        inputDrive: 1.2,
        asymmetry: -0.1,
        outputTrim: 0.9,
        contourMix: 0.3,
        recurrentBias: 0.05,
        convWeights,
    };
}

describe('grinderNeuralProfileParams', () => {
    it('should emit the exact ordered name/value list for a two-layer profile', () => {
        const profile = buildProfile([
            [0.1, 0.2, 0.3],
            [0.4, 0.5, 0.6],
        ]);

        expect(grinderNeuralProfileParams(profile)).toEqual([
            ['neuralCustomTier', 1],
            ['neuralCustomInputDrive', 1.2],
            ['neuralCustomAsymmetry', -0.1],
            ['neuralCustomOutputTrim', 0.9],
            ['neuralCustomContourMix', 0.3],
            ['neuralCustomLstmBias', 0.05],
            ['neuralCustomConvWeight0_0', 0.1],
            ['neuralCustomConvWeight0_1', 0.2],
            ['neuralCustomConvWeight0_2', 0.3],
            ['neuralCustomConvWeight1_0', 0.4],
            ['neuralCustomConvWeight1_1', 0.5],
            ['neuralCustomConvWeight1_2', 0.6],
        ]);
    });

    // Rust's `BuiltinParamName` accepts only ASCII letters, digits, and
    // underscore, at most 40 bytes (crates/daw-engine `BuiltinParamName` rule).
    it('should emit only names matching the BuiltinParamName shape', () => {
        const profile = buildProfile([
            [0.1, 0.2, 0.3],
            [0.4, 0.5, 0.6],
        ]);

        for (const [name] of grinderNeuralProfileParams(profile)) {
            expect(name).toMatch(/^[A-Za-z0-9_]{1,40}$/);
        }
    });

    it('should keep the longest conv-weight name within the 40-byte BuiltinParamName limit for ten layers', () => {
        const convWeights: Array<[number, number, number]> = Array.from({ length: 10 }, (_, layer) => [
            layer,
            layer + 0.1,
            layer + 0.2,
        ]);
        const profile = buildProfile(convWeights);

        const names = grinderNeuralProfileParams(profile).map(([name]) => name);
        const longest_length = Math.max(...names.map((name) => name.length));
        const longest_names = names.filter((name) => name.length === longest_length);

        // Every conv-weight name in this range shares one length (single-digit
        // layer and index), so the tie itself is the proof there is no longer
        // one hiding at a different layer or index.
        expect(longest_names).toContain('neuralCustomConvWeight9_2');
        expect(longest_length).toBe(25);
    });
});
